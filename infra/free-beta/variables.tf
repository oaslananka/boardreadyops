variable "provision" {
  description = "Explicit opt-in for new isolated staging resources; FALSE does nothing."
  type        = bool
  default     = false
}

variable "vercel_team_id" {
  description = "Explicit staging Vercel team ID; never silently use personal account."
  type        = string
  default     = ""

  validation {
    condition     = !var.provision || can(regex("^team_[A-Za-z0-9]+$", var.vercel_team_id))
    error_message = "When provisioning, a verified Vercel team ID must be supplied."
  }
}

variable "neon_org_id" {
  description = "Verified target Neon Free organization ID; must not be inferred from the API key."
  type        = string
  default     = ""

  validation {
    condition     = !var.provision || can(regex("^org-[a-z0-9-]+$", var.neon_org_id))
    error_message = "When provisioning, a verified Neon organization ID must be supplied."
  }
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
  default     = "aws-eu-central-1"
}