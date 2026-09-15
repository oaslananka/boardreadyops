import {
  findVendorProfile,
  listVendorProfiles,
  resolveVendorProfile,
  type VendorProfile,
  vendorProfileAssurance,
} from "../../vendor/profiles.js";

export interface VendorCommandOptions {
  format?: "text" | "json";
}

export function vendorListCommand(
  options: VendorCommandOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): number {
  const profiles = listVendorProfiles();
  if (options.format === "json") {
    streams.stdout.write(`${JSON.stringify(profiles, null, 2)}\n`);
    return 0;
  }
  for (const profile of profiles) {
    const assurance = vendorProfileAssurance(profile);
    streams.stdout.write(
      `${profile.id}\t${profile.name}\t${profile.service}\t${assurance.state}\t${profile.summary}\n`,
    );
  }
  return 0;
}

export function vendorExplainCommand(
  profileInput: string | undefined,
  options: VendorCommandOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): number {
  const profile = findVendorProfile(profileInput);
  if (!profile) {
    streams.stderr.write(`Unknown vendor profile: ${profileInput ?? ""}\n`);
    return 2;
  }
  const resolved = resolveVendorProfile({ profile: profile.id });
  if (options.format === "json") {
    streams.stdout.write(`${JSON.stringify({ profile, requiredOutputs: resolved?.requiredOutputs ?? [] }, null, 2)}\n`);
    return 0;
  }
  streams.stdout.write(`${profile.name} (${profile.id})\n`);
  streams.stdout.write(`${profile.summary}\n`);
  streams.stdout.write(`Service: ${profile.service}\n`);
  // Printed next to the limits rather than buried in the caveats: whoever reads "minDrillMm: 0.3"
  // has to be able to see, in the same breath, whether anybody has checked that this year.
  streams.stdout.write(`${assuranceLine(profile)}\n`);
  streams.stdout.write(`Required outputs: ${(resolved?.requiredOutputs ?? []).join(", ") || "none"}\n`);
  if (profile.fabrication) {
    streams.stdout.write("Fabrication limits:\n");
    for (const [key, value] of Object.entries(profile.fabrication)) {
      streams.stdout.write(`- ${key}: ${value}\n`);
    }
  }
  if (profile.evidence.length > 0) {
    streams.stdout.write("Evidence:\n");
    for (const requirement of profile.evidence) {
      streams.stdout.write(`- ${requirement.output} (${requirement.requiredFor}): ${requirement.rationale}\n`);
    }
  }
  if (profile.caveats.length > 0) {
    streams.stdout.write("Caveats:\n");
    for (const caveat of profile.caveats) {
      streams.stdout.write(`- ${caveat}\n`);
    }
  }
  return 0;
}

/**
 * One line saying how much the numbers above can carry.
 *
 * The distinction that matters is not the date, it is whether a rule may fail a release on these
 * values. An unverified or lapsed limit can be wrong about a board that is fine, and a gate that
 * blocks good boards gets switched off.
 */
function assuranceLine(profile: VendorProfile): string {
  const assurance = vendorProfileAssurance(profile);
  const revision = `revision ${profile.provenance.revision}`;
  if (assurance.state === "verified") {
    return `Assurance: verified ${assurance.ageDays} day(s) ago by ${profile.provenance.verifiedBy} (${revision}); limits may block a release.`;
  }
  if (assurance.state === "stale") {
    return `Assurance: last verified ${assurance.ageDays} day(s) ago (${revision}); the vendor may have changed capability, so these limits advise rather than block.`;
  }
  return `Assurance: unverified (${revision}) -- entered from an unrecorded source at an unknown time. These limits advise rather than block; confirm current capabilities with the vendor before ordering.`;
}
