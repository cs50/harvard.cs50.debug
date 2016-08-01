define(function(require, exports, module) {
    "use strict";

    main.consumes = [
        "Plugin", "commands", "dialog.error", "run", "run.gui"
    ];
    main.provides = ["harvard.cs50.debug"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var commands = imports.commands;
        var run = imports.run;
        var rungui = imports["run.gui"];
        var showError = imports["dialog.error"].show;

        /***** Initialization *****/
        var plugin = new Plugin("Ajax.org", main.consumes);

        function gdb50ExecCommand() {
            // dynamically add a runner that accepts bins and passes
            // directly to the GDB shim, reducing retries since
            // there's no compilation step
            run.addRunner("gdb50", {
                caption: "Debug50",
                debugger: "gdb",
                $debugDefaultState: true,
                executable: '"$file"',
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
                    // args[0] is CWD, args[1..n] are args to command
                    if (args.length < 2)
                        showError("Please enter a filename to debug!");

                    // bin is second argument
                    var exec = args[1];

                    // concat any arg for executable
                    if (args.length > 2)
                        exec += " " + args.slice(2).join(" ");

                    // set runner and command as "last run", and execute it
                    run.getRunner("gdb50", function(err, runner) {
                        if (err)
                            return console.log(err);

                        rungui.lastRun = [runner, exec];
                        commands.exec("runlast");
                    });

                }
            }, plugin);

        }

        function load() {
            gdb50ExecCommand();
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