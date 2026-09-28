locals {
  daemon_runtime = {
    protocol          = "ores.desktop.local-control/v1"
    product_id        = var.product_id
    data_dir          = var.data_dir
    listen            = "${var.listen_host}:${var.listen_port}"
    token_file        = var.token_file
    auth_issuer       = var.auth_issuer
    otel_service_name = var.otel_service_name
    update_channel    = var.update_channel
  }
}
