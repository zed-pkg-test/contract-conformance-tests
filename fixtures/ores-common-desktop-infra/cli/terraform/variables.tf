variable "product_id" {
  type = string
}

variable "daemon_port" {
  type = number
}

variable "token_file" {
  type        = string
  description = "Path to a protected token file. Never place token contents in Terraform variables/state."
}
