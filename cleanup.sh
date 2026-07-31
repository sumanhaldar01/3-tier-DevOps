#!/bin/bash
# cleanup.sh - Run this to delete ALL resources after testing
# Usage: chmod +x cleanup.sh && ./cleanup.sh

set -e

CLUSTER_NAME="devops-hub"
REGION="eu-north-1"

echo "⚠️  This will DELETE the EKS cluster and all resources!"
read -p "Type 'DELETE' to confirm: " confirm
if [ "$confirm" != "DELETE" ]; then
  echo "Aborted."
  exit 1
fi

echo "🗑️  Deleting ArgoCD Application..."
kubectl delete -f argocd-app.yaml --ignore-not-found=true

echo "🗑️  Deleting EKS cluster (this takes 10-15 minutes)..."
eksctl delete cluster -f eksctl-cluster.yaml --wait

echo "✅ Cluster deleted. Checking for leftover resources..."

# Clean up any leftover CloudFormation stacks
aws cloudformation list-stacks --region $REGION --stack-status-filter DELETE_FAILED DELETE_COMPLETE | grep -i $CLUSTER_NAME || true

# Clean up EBS volumes (PVCs may leave volumes behind)
echo "Checking for leftover EBS volumes..."
aws ec2 describe-volumes --region $REGION --filters "Name=tag:kubernetes.io/cluster/$CLUSTER_NAME,Values=owned" --query 'Volumes[].VolumeId' --output text | xargs -r aws ec2 delete-volume --region $REGION --volume-ids

echo "✅ Cleanup complete!"
echo "Note: Check AWS Console for any remaining resources (VPC, IAM roles, CloudWatch logs)"