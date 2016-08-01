define(function(require, exports, module) {
    "use strict";

    main.consumes = [
        "Plugin", "commands", "dialog.error", "debugger", "run", "run.gui", "settings", "util"
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

        function gdb50ExecCommand() {
            settings.set("user/output/nosavequestion", "true");
            // dynamically add a runner that accepts bins and passes
            // directly to the GDB shim, reducing retries since
            // there's no compilation step
            run.addRunner("Debug50", {
                caption: "Debug50",
                debugger: "gdb",
                $debugDefaultState: true,
                retryCount: 100,
                retryInterval: 300,
                script: ['node /home/ubuntu/bin/c9gdbshim.js "$file" $args'],
                socketpath: "/home/ubuntu/.c9/gdbdebugger.socket"
            }, run);

            commands.addCommand({
                name: "gdb50new",
                hint: "Pass args via command",
                group: "General",
                exec: function(args) {
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
                            return console.log(err);

                        rungui.lastRun = [runner, exec];
                        commands.exec("runlast");
                    });

                }
            }, plugin);

        }

        function gdb50OutputToCLI() {
            // to execute:
            // c9 exec gdb50start; node ~/bin/c9gdbshim.js BIN; c9 exec gdb50stop
            commands.addCommand({
                name: "gdb50start",
                hint: "running our debugger",
                group: "General",
                exec: function () {
                    process = debug.run({
                        "debugger": "gdb"
                    }, {
                        path: "",
                        cwd: "",
                        env: {},
                        args: [],
                        debug: true
                    }, "__cs50outputgdbdummy", function(err) {
                        process.running = process.STARTED;
                        console.log(err);});
                }
            }, plugin);

            commands.addCommand({
                name: "gdb50stop",
                hint: "stopping our debugger",
                group: "General",
                exec: function () {
                    console.log(process);
                    debug && debug.stop();
                    process.cleanUp();
                    process && process.stop(function(err) {
                        // process.emit("detach");
                        // process.cleanup();
                        err && console.log(err);
                        console.log(process);
                    });

                }
            }, plugin);
        }

        function load() {
            gdb50ExecCommand();
            gdb50OutputToCLI();
        }

        /***** Methods *****/



        /***** Lifecycle *****/

        plugin.on("load", function() {
            load();
        });
        plugin.on("unload", function() {

        });

        /***** Register and define API *****/

        plugin.freezePublicAPI({

        });

        register(null, {
            "harvard.cs50.debug": plugin
        });
    }
});