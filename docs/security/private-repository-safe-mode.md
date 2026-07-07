# Private repository and fork PR safe mode

Issue: #42

## Goal

BoardReadyOps should treat private repository pull requests and fork pull requests as higher-risk runner contexts.

## Safe-mode triggers

Safe mode is enabled for:

- private repositories,
- pull requests from forks,
- pull requests whose head repository differs from the base repository.

The lifecycle action carries safe-mode reasons:

- `private-repository`
- `fork-pull-request`

## Dispatch behavior

The GitHub App passes safe-mode context to the readiness runner workflow with these inputs:

- `safe_mode`
- `safe_mode_reasons`

## Runner expectations

When safe mode is enabled, runners should avoid privileged writes, avoid exposing private artifacts, avoid using private secrets with fork code, and prefer advisory findings unless a repository policy explicitly opts into enforcement.

## Current implementation slice

This change adds detection, metadata, workflow dispatch inputs, and unit coverage. Additional runtime enforcement should be added before public Marketplace launch.
