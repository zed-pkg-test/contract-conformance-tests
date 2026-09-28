-module(ores_common_desktop_daemon_adapter).

-export([apply_transition/3, allowed_transition/1]).

-callback product_id() -> binary().
-callback apply_transition(atom(), map()) -> ok | {error, term()}.

apply_transition(Adapter, Transition, DesiredState)
        when is_atom(Adapter), is_atom(Transition), is_map(DesiredState) ->
    case allowed_transition(Transition) of
        false ->
            {error, unsupported_transition};
        true ->
            ProductId = Adapter:product_id(),
            case maps:get(product_id, DesiredState, undefined) of
                ProductId ->
                    Adapter:apply_transition(Transition, DesiredState);
                ActualProductId ->
                    {error, {product_id_mismatch, ProductId, ActualProductId}}
            end
    end.

allowed_transition(doctor) -> true;
allowed_transition(status) -> true;
allowed_transition(plan) -> true;
allowed_transition(up) -> true;
allowed_transition(down) -> true;
allowed_transition(reload) -> true;
allowed_transition(update) -> true;
allowed_transition(rollback) -> true;
allowed_transition(routes) -> true;
allowed_transition(logs) -> true;
allowed_transition(deploy) -> true;
allowed_transition(_) -> false.
