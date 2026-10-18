#!/usr/bin/env bash
# Explicit opt-in helper: this script runs a one-off task on AWS when invoked.
set -euo pipefail

kind="${1:-}"
case "$kind" in
  init|migration|seed) ;;
  *) echo "Usage: $0 {init|migration|seed}" >&2; exit 2 ;;
esac
for executable in terraform aws jq; do
  command -v "$executable" >/dev/null || { echo "Required: $executable" >&2; exit 2; }
done
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tf_root="$script_dir/../terraform/environments/sandbox"
configuration="$(terraform -chdir="$tf_root" output -json)"
cluster="$(jq -er '.cluster_name.value' <<< "$configuration")"
region="$(jq -er '.region.value' <<< "$configuration")"
definition="$(jq -er --arg kind "$kind" '.task_definition_arns.value[$kind]' <<< "$configuration")"
network="$(jq -er '.maintenance_network_configuration.value' <<< "$configuration")"
response="$(AWS_PAGER="" aws ecs run-task --region "$region" --cluster "$cluster" \
  --task-definition "$definition" --launch-type FARGATE --platform-version 1.4.0 \
  --count 1 --network-configuration "$network" --output json)"
if ! jq -e '(.failures | length) == 0 and (.tasks | length) == 1' >/dev/null <<< "$response"; then
  jq '.failures' <<< "$response" >&2
  echo "Task was not started successfully." >&2
  exit 1
fi
task="$(jq -er '.tasks[0].taskArn' <<< "$response")"
echo "Started $kind: $task"
if ! AWS_PAGER="" aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks "$task"; then
  echo "Wait ended; task may still be running. Inspect this task before retry/cleanup: $task" >&2
  exit 1
fi
result="$(AWS_PAGER="" aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task" --output json)"
if ! jq -e --arg kind "$kind" '
  (.failures | length) == 0 and
  (.tasks | length) == 1 and
  .tasks[0].lastStatus == "STOPPED" and
  ([.tasks[0].containers[] | select(.name == $kind and .exitCode == 0)] | length) == 1
' >/dev/null <<< "$result"; then
  jq '{failures, tasks: [.tasks[] | {taskArn, stopCode, stoppedReason, containers: [.containers[] | {name, exitCode, reason}]}]}' <<< "$result" >&2
  echo "$kind failed; check its CloudWatch logs. Services must not be started after failed initialization/migration." >&2
  exit 1
fi
echo "$kind completed (exit 0)."
