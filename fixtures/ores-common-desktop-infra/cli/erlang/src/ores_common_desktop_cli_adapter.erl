-module(ores_common_desktop_cli_adapter).

-export([resolved_config/1]).

-callback product_id() -> binary().
-callback daemon_endpoint() -> binary().
-callback token_file() -> binary().

resolved_config(Adapter) when is_atom(Adapter) ->
    ProductId = Adapter:product_id(),
    DaemonEndpoint = Adapter:daemon_endpoint(),
    TokenFile = Adapter:token_file(),
    case validate(ProductId, DaemonEndpoint, TokenFile) of
        ok ->
            {ok, #{
                product_id => ProductId,
                daemon_endpoint => DaemonEndpoint,
                token_file => TokenFile
            }};
        {error, _Reason} = Error ->
            Error
    end.

validate(ProductId, DaemonEndpoint, TokenFile)
        when is_binary(ProductId), byte_size(ProductId) > 0,
             is_binary(DaemonEndpoint), byte_size(DaemonEndpoint) > 0,
             is_binary(TokenFile), byte_size(TokenFile) > 0 ->
    ok;
validate(_ProductId, _DaemonEndpoint, _TokenFile) ->
    {error, invalid_resolved_config}.
