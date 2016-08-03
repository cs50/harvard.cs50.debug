# harvard.cs50.debug

## Installation

This plugin will not function properly without the below.

Apply the following 3 PRs to your existing installation of `c9.ide.run.debug`:
[38](https://github.com/c9/c9.ide.run.debug/pull/38),
[39](https://github.com/c9/c9.ide.run.debug/pull/39),
[40](https://github.com/c9/c9.ide.run.debug/pull/40)

And apply the following PR to your existing installation of `c9.ide.run`:
[16](https://github.com/c9/c9.ide.run/pull/16)

Note that the above steps are obsolete once all PRs are accepted into core and
published to production.

Then you may install this plugin and reload the workspace.

## Usage

This plugin adds several Cloud9 commands that allows execution of the
debugger from the command line. This comes in two flavors, and both
are enabled by default.

### `gdb50new`

The `gdb50new` command leverages the existing Cloud9 run/debug system
to start a process. It is effectively equivalent to hitting the "Run"
button at the top of a workspace, and preconfigured to always use the
GDB GUI debugger. Using it is simple:

```
$ c9 exec gdb50new BIN [ARGS]
```

Where `BIN` is the binary name and `ARGS` are one or more arguments applied
to the binary at execution.

You might also put this in an alias to make things easier:

```
$ alias debug50new="c9 exec gdb50new"
$ debug50new BIN [ARGS]
```

### `gdb50{start,end}`

The `gdb50start` and `gdb50end` commands try to allow the user to
execute their binary directly in a terminal window, but still connect
the GUI debugger to the running process without opening a new console window.

They use the existing run and debug system where possible, but provide an
extraneous process to satisfy their requirements.
In particular, `run.gui` normally expects a command to be executed, creates
a new `tmux` session for it, and opens a new console window showing that
`tmux` session with a lot of chrome describing the `runner` used to begin
the process.
However, `run.run` allows us to run a command in a new `tmux` session and
expects us to display it to the user.
We simply chose not to display it, since the output of the executable is
already being shown in the user's terminal.

The run system monitors this session for consistent state, so we get
around the issue by providing a process that effectively acts as a proxy
for the process we're running in the existing terminal.
This "proxy" simply monitors the PID of the GDB shim, and destroys itself
within ~1 second of when the shim quits.
The internal state of the `process` object (and therefore the `run` and
`debug` objects) can then stay consistent.

Process management is therefore required for this to work.
We create a process in the shell, provide the PID of that process to
`gdb50start`, which then creates the "proxy" process to monitor it.
Once debugging is complete, `gdb50exit` is provided the same PID
to clean up the tmux session and `process` and `debug` object state.

To use this, simply create a shell script with the following contents:

```
#!/bin/bash

# check for running shims already
#if pgrep -f c9gdbshim.js &>/dev/null ; then
#    echo "You are already running $0! Please quit it and try again."
#    exit 1
#fi

# PID of current execution
PID=$$

# give PID to proxy for monitoring
ERR="$(/var/c9sdk/bin/c9 exec gdb50start $PID)"

# c9 exec doesn't return non-zero on error!
if [ "$ERR" = "Could not execute gdb50start" ]; then
    echo "Unable to start!"
    exit 1
fi

# execute the shim which starts gdb and executable, and waits for GUI debugger
node /home/ubuntu/bin/c9gdbshim.js $@

# cleanup
/var/c9sdk/bin/c9 exec gdb50stop $PID

# spit out a final newline
echo
```

Paste the contents of that file into a file called `debug50` in
your `$PATH`, and be sure to `chmod +x` it.

Then you may get started with:
```
debug50 BIN [ARGS]
```