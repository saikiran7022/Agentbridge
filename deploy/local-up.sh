#!/usr/bin/env bash
# Build the Hub images and install the chart into the current kubectl context (kind, k3d, minikube,
# Docker Desktop). Uses dev login, so only run this against a local cluster.
#
#   ./deploy/local-up.sh                     # Hub + bundled Postgres/Redis in namespace "hub"
#   DEMO=true ./deploy/local-up.sh           # also seed the demo "payments" project
#   AGENT_MODE=off ./deploy/local-up.sh      # no kagent yet: route every request to people
set -euo pipefail

cd "$(dirname "$0")/.."
NAMESPACE="${NAMESPACE:-hub}"
RELEASE="${RELEASE:-agent-liaison-hub}"
TAG="${TAG:-dev}"
HUB_URL="${HUB_URL:-http://localhost:3000}"
AGENT_MODE="${AGENT_MODE:-kagent}"
DEMO="${DEMO:-false}"

echo "==> Building images (tag $TAG)"
docker build --target web -t "agent-liaison-hub-web:$TAG" .
docker build --target worker -t "agent-liaison-hub-worker:$TAG" .

context="$(kubectl config current-context)"
echo "==> kubectl context: $context"
case "$context" in
  kind-*)
    kind load docker-image "agent-liaison-hub-web:$TAG" "agent-liaison-hub-worker:$TAG" --name "${context#kind-}" ;;
  k3d-*)
    k3d image import "agent-liaison-hub-web:$TAG" "agent-liaison-hub-worker:$TAG" -c "${context#k3d-}" ;;
  minikube)
    minikube image load "agent-liaison-hub-web:$TAG"
    minikube image load "agent-liaison-hub-worker:$TAG" ;;
  *)
    echo "    assuming the cluster can see local Docker images (Docker Desktop / Rancher Desktop)" ;;
esac

if [[ "$AGENT_MODE" == "kagent" ]] && ! kubectl get crd agents.kagent.dev >/dev/null 2>&1; then
  echo "!! kagent CRDs not found. Install kagent first (docs/kagent.md) or rerun with AGENT_MODE=off." >&2
  exit 1
fi

echo "==> Installing chart into namespace $NAMESPACE"
helm upgrade --install "$RELEASE" deploy/helm/agent-liaison-hub \
  --namespace "$NAMESPACE" --create-namespace \
  --set image.web.tag="$TAG" --set image.worker.tag="$TAG" \
  --set hubUrl="$HUB_URL" \
  --set auth.devLogin=true \
  --set agents.mode="$AGENT_MODE" \
  --set agents.kubeApply="$([[ "$AGENT_MODE" == "kagent" ]] && echo true || echo false)" \
  --set migrations.demo="$DEMO" \
  --wait --timeout 10m

echo
echo "==> Ready. In another terminal:"
echo "    kubectl -n $NAMESPACE port-forward svc/$RELEASE-web 3000:3000"
echo "    open $HUB_URL and sign in with any login (the first one becomes admin)"
