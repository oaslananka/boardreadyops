output "vercel_project_id" {
  description = "New staging Vercel project ID, if explicitly provisioned."
  value       = var.provision ? vercel_project.web[0].id : null
}

output "neon_project_id" {
  description = "New staging Neon project ID, if explicitly provisioned."
  value       = var.provision ? neon_project.db[0].id : null
}