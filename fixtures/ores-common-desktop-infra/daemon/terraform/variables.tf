variable "product_id" {
  type = string
}

variable "data_dir" {
  type = string
}

variable "listen_host" {
  type    = string
  default = "127.0.0.1"

  validation {
    condition     = contains(["127.0.0.1", "::1"], var.listen_host)
    error_message = "desktop daemon must bind to loopback by default."
  }
}

variable "listen_port" {
  type = number
}

variable "token_file" {
  type        = string
  description = "Protected local token path; token contents must not enter Terraform state."
}

variable "auth_issuer" {
  type    = string
  default = "https://ores-shared-auth.com"
}

variable "otel_service_name" {
  type = string
}

variable "update_channel" {
  type    = string
  default = "candidate"
}
