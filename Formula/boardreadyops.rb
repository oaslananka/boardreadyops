class Boardreadyops < Formula
  desc "CI preflight for production-ready PCBs"
  homepage "https://github.com/oaslananka/boardreadyops"
  version "1.72.0"
  license "AGPL-3.0-only"

  # Release v1.72.0 checksums from SHA256SUMS, matched to published asset digests.
  # Regenerate with: gh release download v#{version} && sha256sum boardreadyops-* > SHA256SUMS
  on_macos do
    on_arm do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-macos-arm64"
      sha256 "91c2389ac1aedd015b7fc9de3b4df896f74d11a813d20881f2c1e9e9d40aae73"
    end

    on_intel do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-macos-x64"
      sha256 "1ddc735eb44ed54c51a98ded70fd8f607c4e4431cfbc278967352f921c45726e"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-linux-arm64"
      sha256 "9a4da4618af90ebd0aebe14efdb511af187d7619668cabbca19dd62f27d133a0"
    end

    on_intel do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-linux-x64"
      sha256 "0291fddf1fc38cad8f5a4a893a5f9867f2477d7f57fee6d15aa25a37568f7bed"
    end
  end

  def install
    bin.install Dir["boardreadyops-*"].first => "boardreadyops"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/boardreadyops --version")
  end
end
