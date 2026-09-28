locals {
  cli_runtime = {
    product_id       = var.product_id
    daemon_endpoint  = "http://127.0.0.1:${var.daemon_port}"
    token_file       = var.token_file
    parser_authority = "flags-2-env"
  }
}
