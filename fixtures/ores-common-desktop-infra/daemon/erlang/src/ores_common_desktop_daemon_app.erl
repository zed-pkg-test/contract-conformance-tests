-module(ores_common_desktop_daemon_app).
-behaviour(application).

-export([start/2, stop/1]).

start(_StartType, _StartArgs) ->
    ores_common_desktop_daemon_sup:start_link().

stop(_State) ->
    ok.
