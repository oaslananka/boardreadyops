variable "provision" {
  description = "Explicit opt-in for new isolated staging resources; FALSE does nothing."
  type        = bool
  default     = false
}

variable "vercel_project_name" {
  description = "Isolated Free Beta Vercel project, not the existing production domain."
  type        = string
  default     = "boardreadyops-free-beta"
}

variable "neon_project_name" {
  description = "Isolated Free Beta database, never production data."
  type        = string
  default     = "boardreadyops-free-beta"
}

variable "neon_region" {
  description = "The operator-verified Neon region (check free-tier and runtime proximity)."
  type        = string
  default     = "aws-us-east-2"
}