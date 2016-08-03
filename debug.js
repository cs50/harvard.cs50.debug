define(function(require, exports, module) {
    "use strict";

    main.consumes = [
        "Plugin", "commands", "dialog.error", "debugger", "run", "run.gui",
        "settings", "util"
    ];
    main.provides = ["harvard.cs50.debug"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var commands = imports.commands;
        var debug = imports.debugger;
        var run = imports.run;
        var rungui = imports["run.gui"];
        var showError = imports["dialog.error"].show;
        var settings = imports.settings;
        var util = imports.util;

        var Path = require("path");

        /***** Initialization *****/
        var plugin = new Plugin("Ajax.org", main.consumes);
        var process = [];
        var debugging = false;

        // delay execution of next debugging process if old is killed
        var subsequent = null;

        // PID of the shim
        var SETTING_PID="project/cs50/debug/@pid";

        // PID of the (hidden) proxy process that monitors shim
        var SETTING_PROXY="project/cs50/debug/@proxy";

        // name of the (hidden) proxy process
        var SETTING_NAME="project/cs50/debug/@name";

        /***** Methods *****/

        /**
         * Dynamically add runners for the gdb50* processes.
         */
        function createRunners() {
            // Accepts bins and passes directly to GDB shim;
            // To be used by standard run system.
            run.addRunner("Debug50", {
                caption: "Debug50",
                script: ['node /home/ubuntu/bin/c9gdbshim.js "$file" $args'],
                debugger: "gdb",
                $debugDefaultState: true,
                retryCount: 100,
                retryInterval: 300,
                socketpath: "/home/ubuntu/.c9/gdbdebugger.socket"
            }, run);

            // Monitors a shim started on the command line.
            run.addRunner("Shell50", {
                caption: "Shell50",
                script: ['while kill -0 $args ; do sleep 1; done'],
                debugger: "gdb",
                $debugDefaultState: true,
                retryCount: 100,
                retryInterval: 300,
                socketpath: "/home/ubuntu/.c9/gdbdebugger.socket"
            }, run);
        }

        /**
         * Kick off a GDB runner via the standard run system
         * (with a new process window) from the command line.
         *
         * @param {[string]} CWD, bin to execute, and cli args
         */
        function gdb50New(args) {
            // args[0] is CWD, args[1..n] are args to c9 command
            if (args.length < 2)
                return showError("Please enter a filename to debug!");

            // cwd is first arg, bin is second argument
            var exec = util.escapeShell(Path.join(args[0], args[1]));

            // concat any arg for executable
            if (args.length > 2)
                exec += " " + args.slice(2).join(" ");

            // set runner and command as "last run", and execute it
            run.getRunner("Debug50", function(err, runner) {
                if (err)
                    return showError("Cannot find correct runner!");

                rungui.lastRun = [runner, exec];
                commands.exec("runlast");
            });
        }

        /**
         * Helper function for gdb50Start to display errors.
         */
        function handleErr(proc, err) {
            showError(proc, "error:", err);
        }

        /**
         * Given a process object, ask the debugger to start debugging
         * it, and reconnecting the debugger to an existing running
         * procerss if necessary.
         */
        function startDebugging(pid, reconnect) {
            if (reconnect == undefined)
                reconnect = false;

            // kick off debugger
            debug.debug(process[pid], reconnect, function(err) {
                if (err) {
                    handleErr("Debug start", err);
                    return cleanState(pid);
                }

                // successfully opened debugger
                debugging = true;

                // store pid state for later use
                settings.set(SETTING_PID, pid);
                settings.set(SETTING_PROXY, process[pid].pid);
                settings.set(SETTING_NAME, process[pid].name);
            });
        }

        /**
         * Helper function to start the runner and kick off debug
         * process, saving state in event of reconnect.
         */
        function startProxy(cwd, pid, runner) {
            // provide proxy process with pid to monitor
            var procOpts = {
                cwd: cwd,
                args: [pid.toString()],
                debug: true
            };

            // start proxy process and begin debugging if successful
            process[pid] = run.run(runner, procOpts, function(err) {
                if (err)
                    return handleErr("Proxy process run", err);

                startDebugging(pid);
            });
        }

        /**
         * Helper function to clean process and debugger state.
         */
        function cleanState(pid) {
            if (debugging)
                debug.stop();

            if (pid)
                delete process[pid];

            debugging = false;

            settings.set(SETTING_PID, null);
            settings.set(SETTING_NAME, null);
            settings.set(SETTING_PROXY, null);

            if (subsequent) {
                subsequent();
                subsequent = null;
            }
        }


        /**
         * Start a process that serves as a proxy for a GDB shim
         * already running on the command line. The proxy simply
         * monitors the shim process and is used by the debugger
         * API to determine if the process is still running.
         * Execute with:
         * `c9 exec gdb50start; node ~/bin/c9gdbshim.js BIN ARGS`;
         *  c9 exec gdb50stop`
         */
        function gdb50Start(args, reconnect) {
            if (args.length != 2) {
                showError("Error: expected process PID!");
                return false;
            }

            // process pid passed by argument
            var pid = args[1];

            // fetch shell runner
            run.getRunner("Shell50", function(err, runner) {
                if (err)
                    return handleErr("Runner fetch", err);

                // make sure debugger isn't already running
                debug.checkAttached(function() {
                    // no cli process running
                    if (!debugging)
                        return startProxy(args[0], pid, runner);

                    // wait to startProxy until old has stopped
                    subsequent = startProxy.bind(this, args[0], pid, runner);
                });
            });
        }

        /**
         * gdb50Stop
         * Stops and cleans a debug process started with gdb50Start.
         */
        function gdb50Stop(args) {
            if (args.length != 2) {
                showError("Error: expected process PID!");
                return false;
            }

            // close debugger right away (waiting for proc to stop takes time)
            if (debugging)
                debug.stop();

            // process pid passed by argument
            var pid = args[1];

            // must only run if a process is running
            if (process[pid] === undefined)
                return false;

            // stop PID and clean up
            process[pid].stop(cleanState.bind(this, pid));
        }

        /**
         * Check to see if we've saved a running process in the past.
         * Try to restore it and re-connect the debugger to it, if it
         * exists.
         */
        function restoreProcess() {
            var proxy = settings.getNumber(SETTING_PROXY);
            var pid = settings.getNumber(SETTING_PID);
            var name = settings.get(SETTING_NAME);

            if (!proxy || !pid || !name)
                return;

            // to rebuild process we need the runner
            run.getRunner("Shell50", function(err, runner) {
                if (err)
                    return cleanState(pid);

                // recover process from saved state
                process[pid] = run.restoreProcess({
                    pid: proxy,
                    name: name,
                    runner: [runner],
                    running: run.STARTED
                });

                // reconnect the debugger
                startDebugging(pid, true);
            });
        }

        function load() {
            // don't allow users to see "Save Runner?" dialog
            settings.set("user/output/nosavequestion", "true");

            // install runners used by exec commands
            createRunners();

            // create commands that can be called from `c9 exec`
            commands.addCommand({
                name: "gdb50start",
                hint: "Kickstart GDB debugger from CLI",
                group: "Run & Debug",
                exec: gdb50Start
            }, plugin);

            commands.addCommand({
                name: "gdb50stop",
                hint: "Stop GDB debugger started from CLI",
                group: "Run & Debug",
                exec: gdb50Stop
            }, plugin);

            commands.addCommand({
                name: "gdb50new",
                hint: "Start a standard debug window from CLI",
                group: "Run & Debug",
                exec: gdb50New
            }, plugin);

            // try to restore state if a running process
            restoreProcess();
        }

        /***** Lifecycle *****/

        plugin.on("load", function() {
            load();
        });
        plugin.on("unload", function() {
            process = null;
            subsequent = null;
            debugging = false;
        });

        /***** Register and define API *****/

        plugin.freezePublicAPI({});

        register(null, {
            "harvard.cs50.debug": plugin
        });
    }
});
