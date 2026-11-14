# Staging-only IaC blueprint. Neither tofu init nor tofu plan creates resources.
# All resources are disabled unless an operator deliberately sets provision = true.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "5.24.1"
    }
    neon = {
      source  = "terraform-community-providers/neon"
      version = "0.1.15"
    }
  }
}

provider "vercel" {}
provider "neon" {}

# Intentionally no Git auto-deploy, custom production domain, or Vercel deployment.
# Vercel must pass a separate non-commercial Hobby eligibility review and
# a real Next.js preview acceptance before a production domain can move.
resource "vercel_project" "web" {
  count          = var.provision ? 1 : 0
  name           = var.vercel_project_name
  framework      = "nextjs"
  root_directory = "apps/web"
}

resource "vercel_project_environment_variable" "beta_mode" {
  count      = var.provision ? 1 : 0
  project_id = vercel_project.web[0].id
  key        = "BILLING_MODE"
  value      = "beta_free"
  sensitive  = false
  target     = ["production", "preview"]
}

# Free tier must be verified against the specific Neon account before apply.
# The project is isolated: production DB is never changed by this blueprint.
resource "neon_project" "db" {
  count     = var.provision ? 1 : 0
  name      = var.neon_project_name
  region_id = var.neon_region
}