class Boardreadyops < Formula
  desc "CI preflight for production-ready PCBs"
  homepage "https://github.com/oaslananka/boardreadyops"
  version "1.31.1"
  license "MIT"

  # Release v1.31.1 checksums from SHA256SUMS.
  # Regenerate with: gh release download v#{version} && sha256sum boardreadyops-* > SHA256SUMS
  on_macos do
    on_arm do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-macos-arm64"
      sha256 "662b7d995e627f58f4769725e672a247a398bd964e019fa1ccf45ce018b93508"
    end

    on_intel do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-macos-x64"
      sha256 "b8967a5b967bf2466a183ec759c5a435a094a1778e1abe80c8dce12f40d69088"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-linux-arm64"
      sha256 "cc1184b64a48ecdeaaa67139396b62026b99f0e54453a8511435ed9ef0b66afd"
    end

    on_intel do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-linux-x64"
      sha256 "14624bd6a6d658d59cee81fe5402329860a334c563df6fed3f21c5cf656c1e41"
    end
  end

  def install
    bin.install Dir["boardreadyops-*"].first => "boardreadyops"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/boardreadyops --version")
  end
end
