# harvard.cs50.debug

## Usage

This plugin adds several Cloud9 commands that allows execution of the
debugger from the command line. This comes in two flavors, and both
are enabled by default.

### `gdb50new`

The `gdb50new` command leverages the existing Cloud9 run/debug system
to start a process. It is effectively equivalent to hitting the "Run"
button at the top of a workspace, and preconfigured to always use the
GDB GUI debugger. Using it is simple:

```bash
$ c9 exec gdb50new BIN [ARGS]
```

Where `BIN` is the binary name and `ARGS` are one or more arguments applied
to the binary at execution.

Although you could put this into an alias, we also write a script
called `debug50` into `~/bin` that can begin the runner this way:

```bash
$ debug50 --open BIN [ARGS]
```

The `debug50` command will accept either `-o` or `--open`.

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
If everything checks out, the plugin sends `debug50` a `SIGUSR1` signal,
which then uses that to start the shim process.
This signal prevents starting the shim prematurely; for example, if
the user selects when asked that they do not wish to stop an existing
debug process.
If the shim is begun, `gdb50exit` is called after debugging is complete,
and provided the same PID, to clean up the tmux session and `process`
and `debug` object state.

To use this, simply call `debug50`, which is installed in `~/bin` (and
should be in the `$PATH` by default):

```bash
$ debug50 BIN [ARGS]
```

Compare the separate code paths in the `debug50` script in this repo
to see how it begins `gdb50new` vs `gdb50start` and `gdb50stop`.
