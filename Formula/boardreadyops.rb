class Boardreadyops < Formula
  desc "CI preflight for production-ready PCBs"
  homepage "https://github.com/oaslananka/boardreadyops"
  version "1.31.2"
  license "MIT"

  # Release v1.31.2 checksums from SHA256SUMS.
  # Regenerate with: gh release download v#{version} && sha256sum boardreadyops-* > SHA256SUMS
  on_macos do
    on_arm do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-macos-arm64"
      sha256 "8da3869b938f3f58bf06cf6f1c8806cd39a227e4189e37748ba3e8a3174be15b"
    end

    on_intel do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-macos-x64"
      sha256 "534a45db6aad60c4a76a4798f5c7beb59f2dc526996ee54366cb9f0defbc5abd"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-linux-arm64"
      sha256 "883ea3c4d27ec40c59eba2e2ffb9fd5dd271abc0c22b79cc089271dfd838e642"
    end

    on_intel do
      url "https://github.com/oaslananka/boardreadyops/releases/download/v#{version}/boardreadyops-linux-x64"
      sha256 "5d843b1729e40c63170d50d154f481173d3edcd72e5cf0d32609733ad4ce10fb"
    end
  end

  def install
    bin.install Dir["boardreadyops-*"].first => "boardreadyops"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/boardreadyops --version")
  end
end
