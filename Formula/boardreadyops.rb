class Boardreadyops < Formula
  desc "CI preflight for production-ready PCBs"
  homepage "https://github.com/oaslananka/boardreadyops"
  version "1.30.1"
  license "MIT"

  # Release v1.30.1 checksums from SHA256SUMS.
  # Regenerate with: gh release download v#{version} && sha256sum boardreadyops-* > SHA256SUMS
  on_macos do
    on_arm do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-macos-arm64"
      sha256 "6f9d1d9f3cc04c4380f7ccfb8ccecd58bf9ea8c4b473f2b78b39308ef9c1ba7f"
    end

    on_intel do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-macos-x64"
      sha256 "411b083dd6c2ab675404cdd8e5f62d1c1371b4b3e5825c8409ed0464514c4034"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-linux-arm64"
      sha256 "a546c1a4339b32f26000c916471fb8f5dfc007c47ff4c88116a28356f213eca8"
    end

    on_intel do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-linux-x64"
      sha256 "c1515abbdafab8e46e63feb65e3c9899babf51e256a4e8ed128046539bd1b520"
    end
  end

  def install
    bin.install Dir["boardreadyops-*"].first => "boardreadyops"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/boardreadyops --version")
  end
end
