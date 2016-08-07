define(function(require, exports, module) {
    "use strict";

    main.consumes = [
        "Plugin", "commands", "dialog.error", "debugger", "editors", "fs",
        "gdbdebugger", "proc", "run", "run.gui", "settings", "tabManager", "ui",
        "util"
    ];
    main.provides = ["harvard.cs50.debug"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var commands = imports.commands;
        var debug = imports.debugger;
        var editors = imports.editors;
        var fs = imports.fs;
        var gdbdebugger = imports.gdbdebugger;
        var proc = imports.proc;
        var run = imports.run;
        var rungui = imports["run.gui"];
        var showError = imports["dialog.error"].show;
        var settings = imports.settings;
        var tabManager = imports.tabManager;
        var ui = imports.ui;
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

        // path of debug50 script revision number
        var SETTING_VER="project/cs50/debug/@ver";

        // version of debug50 file
        var DEBUG_VER=2;

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
            // start shim by sending debug50 the SIGUSR1 signal
            proc.spawn("kill", { args: ["-SIGUSR1", pid] }, function() {});

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
                }, function() {
                    // user cancelled, abort the debug50 call
                    proc.spawn("kill", { args: [pid] }, function() {});
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

        /**
         * Simplifies the interface of an "output" editor (terminal debugger).
         *
         * @param {Editor} editor an editor of type output
         */
        function simplifyGui(editor) {
            if (!editor || editor.type !== "output")
                return;

            var toolbar = editor.aml.childNodes[1];
            toolbar.$ext.classList.add("debug50");

            // swap run and restart buttons
            var btnRun = editor.getElement("btnRun");
            var btnRestart = btnRun.nextSibling;
            btnRestart.removeNode();
            toolbar.insertBefore(btnRestart, btnRun);

            // hide name input field
            var tbName = editor.getElement("tbName");
            tbName.setAttribute("visible", false);

            // rename "Command:" to "argv"
            var commandLabel = tbName.nextSibling.nextSibling;
            commandLabel.$ext.innerHTML = "argv";
            commandLabel.$ext.classList.add("argv-label");

            // hide debug button
            editor.getElement("btnDebug").$ext.style.visibility = "hidden";

            // hide Runner button
            editor.getElement("btnRunner").setAttribute("visible", false);

            // hide CWD button
            editor.getElement("btnCwd").setAttribute("visible", false);

            // hide ENV button
            editor.getElement("btnEnv").setAttribute("visible", false);
        }

        /**
         * Should be called with an output editor when first created only.
         * Simplifies gui and styles argv field of the editor initially, and
         * sets up listeners to style argv on skin change, and disable while
         * debugger is running.
         *
         * @param {object} e an object with a property, editor, that's an editor
         * of type output.
         */
        function customizeDebugger(e) {
            var editor = e.editor;

            // ensure editor is "output"
            if (!editor || editor.type !== "output")
                return;

            // simplify debugger gui initially
            simplifyGui(editor);

            /**
             * Styles argv based on current skin.
             *
             * @param {string} [skin] the current skin
             */
            var styleArgv = (function () {
                // whether skin is dark initially
                var dark = settings.get("user/general/@skin").indexOf("dark") > -1;

                // argv field
                var tbCommand = editor.getElement("tbCommand");
                return function (skin) {
                    if (skin)
                        // update dark
                        dark = skin.indexOf("dark") > -1;

                    // style argv field
                    tbCommand.$ext.classList.add("argv");
                    if (dark)
                        tbCommand.$ext.classList.add("dark");
                    else
                        tbCommand.$ext.classList.remove("dark");
                };
            })();

            // style argv input initially
            styleArgv();

            // style argv on skin change
            settings.on("user/general/@skin", styleArgv);

            /**
             * Toggles argv's editability based on debugger state.
             *
             * @param {object} e an object with a property, state, representing
             * the current state of gdbdebugger
             */
            var toggleArgvEdit = (function () {
                var tbCommand = editor.getElement("tbCommand");
                return function (e) {
                    if (!e || typeof e.state === "undefined")
                        return;

                    tbCommand.setAttribute("disabled", e.state !== null);
                };
            })();

            // toggle argv's editability initially
            toggleArgvEdit({ state: gdbdebugger.state });

            // disable argv when debugger runs only
            gdbdebugger.on("stateChange", toggleArgvEdit);
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

            // write most recent debug50 script
            var ver = settings.getNumber(SETTING_VER);

            if (isNaN(ver) || ver < DEBUG_VER) {
                var content = require("text!./bin/debug50");
                fs.writeFile("~/bin/debug50", content, function(err){
                    if (err) return console.error(err);

                    fs.chmod("~/bin/debug50", 755, function(err){
                        if (err) return console.error(err);
                        settings.set(SETTING_VER, DEBUG_VER);
                    });
                });
            }

            // try to restore state if a running process
            restoreProcess();

            // simplify "output" editors after reload
            // handling "create" isn't enough as not handled on page reload
            tabManager.getPanes().each(function(pane) {
                pane.getEditors().each(function(editor) {
                    customizeDebugger({editor:editor});
                });
            });

            // simplify newly created "output" editors
            editors.on("create", customizeDebugger);
            ui.insertCss(require("text!./style.css"), options.staticPrefix, plugin);
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
