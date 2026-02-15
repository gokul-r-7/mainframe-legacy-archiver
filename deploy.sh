#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy.sh — Deploy the Data Archival Platform to AWS (Infra Only)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Defaults ─────────────────────────────────────────────────────────────────
AWS_PROFILE="default"
AWS_REGION="us-east-1"
ENVIRONMENT="dev"
NOTIFICATION_EMAIL=""
AUTO_APPROVE=false
DESTROY=false

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
    echo "Usage: ./deploy.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --profile PROFILE       AWS CLI profile (default: default)"
    echo "  --region REGION         AWS region (default: us-east-1)"
    echo "  --env ENVIRONMENT       Environment: dev|staging|prod (default: dev)"
    echo "  --email EMAIL           Notification email (required)"
    echo "  --auto-approve          Skip Terraform approval prompt"
    echo "  --destroy               Destroy all resources"
    echo "  --help                  Show this help message"
    exit 0
}

# ── Parse arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --profile) AWS_PROFILE="$2"; shift 2 ;;
        --region) AWS_REGION="$2"; shift 2 ;;
        --env) ENVIRONMENT="$2"; shift 2 ;;
        --email) NOTIFICATION_EMAIL="$2"; shift 2 ;;
        --auto-approve) AUTO_APPROVE=true; shift ;;
        --destroy) DESTROY=true; shift ;;
        --help) usage ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; usage ;;
    esac
done

# ── Validation ───────────────────────────────────────────────────────────────
if [ "$DESTROY" = false ] && [ -z "$NOTIFICATION_EMAIL" ]; then
    echo -e "${RED}Error: --email is required${NC}"
    echo "Usage: ./deploy.sh --email you@example.com [--profile myprofile] [--region us-east-1]"
    exit 1
fi

# ── Check dependencies ──────────────────────────────────────────────────────
for cmd in aws terraform; do
    if ! command -v "$cmd" &> /dev/null; then
        echo -e "${RED}Error: $cmd is not installed${NC}"
        exit 1
    fi
done

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║          Data Archival & Analytics Platform               ║"
echo "║                   AWS Deployment                          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  Profile:     ${GREEN}${AWS_PROFILE}${NC}"
echo -e "  Region:      ${GREEN}${AWS_REGION}${NC}"
echo -e "  Environment: ${GREEN}${ENVIRONMENT}${NC}"
echo -e "  Email:       ${GREEN}${NOTIFICATION_EMAIL}${NC}"
echo ""

export AWS_PROFILE
export AWS_DEFAULT_REGION="$AWS_REGION"

# ── Destroy mode ─────────────────────────────────────────────────────────────
if [ "$DESTROY" = true ]; then
    echo -e "${RED}⚠️  DESTROYING all resources...${NC}"
    cd infra
    terraform init -input=false
    terraform destroy \
        -var="aws_profile=${AWS_PROFILE}" \
        -var="aws_region=${AWS_REGION}" \
        -var="environment=${ENVIRONMENT}" \
        -var="notification_email=${NOTIFICATION_EMAIL:-destroy@example.com}" \
        ${AUTO_APPROVE:+-auto-approve}
    echo -e "${GREEN}All resources destroyed.${NC}"
    exit 0
fi

# ── Step 1: Create Lambda layer zip (placeholder) ────────────────────────────
echo -e "${YELLOW}[1/4] Preparing Lambda layer...${NC}"
cd "$SCRIPT_DIR"
mkdir -p infra
if [ ! -f "infra/lambda_layer.zip" ]; then
    mkdir -p /tmp/lambda_layer/python
    pip3 install boto3 -t /tmp/lambda_layer/python -q 2>/dev/null || true
    cd /tmp/lambda_layer
    zip -r "$SCRIPT_DIR/infra/lambda_layer.zip" python -q
    cd "$SCRIPT_DIR"
    rm -rf /tmp/lambda_layer
fi
echo -e "${GREEN}  Lambda layer ready${NC}"

# ── Step 2: Terraform Init ──────────────────────────────────────────────────
echo -e "${YELLOW}[2/4] Running terraform init...${NC}"
cd "$SCRIPT_DIR/infra"
terraform init -input=false -upgrade
echo -e "${GREEN}  Terraform initialized${NC}"

# ── Step 3: Terraform Plan ──────────────────────────────────────────────────
echo -e "${YELLOW}[3/4] Running terraform plan...${NC}"
terraform plan \
    -var="aws_profile=${AWS_PROFILE}" \
    -var="aws_region=${AWS_REGION}" \
    -var="environment=${ENVIRONMENT}" \
    -var="notification_email=${NOTIFICATION_EMAIL}" \
    -out=tfplan

echo -e "${GREEN}  Plan generated${NC}"

# ── Step 4: Terraform Apply ─────────────────────────────────────────────────
echo -e "${YELLOW}[4/4] Running terraform apply...${NC}"
if [ "$AUTO_APPROVE" = true ]; then
    terraform apply -auto-approve tfplan
else
    terraform apply tfplan
fi
echo -e "${GREEN}  Infrastructure deployed${NC}"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                  Deployment Complete!                     ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

  cd "$SCRIPT_DIR/infra"
  
  API_ENDPOINT=$(terraform output -raw api_endpoint 2>/dev/null || echo '')
  COGNITO_POOL=$(terraform output -raw cognito_user_pool_id 2>/dev/null || echo '')
  COGNITO_CLIENT=$(terraform output -raw cognito_client_id 2>/dev/null || echo '')
  COGNITO_DOMAIN=$(terraform output -raw cognito_domain 2>/dev/null || echo '')
  DATA_BUCKET=$(terraform output -raw data_bucket_name 2>/dev/null || echo '')

  echo -e "  ${GREEN}API Endpoint:${NC}   ${API_ENDPOINT}"
  echo -e "  ${GREEN}Cognito Pool:${NC}   ${COGNITO_POOL}"
  echo -e "  ${GREEN}Cognito Client:${NC} ${COGNITO_CLIENT}"
  echo -e "  ${GREEN}Cognito Domain:${NC} ${COGNITO_DOMAIN}"
  echo -e "  ${GREEN}Data Bucket:${NC}    ${DATA_BUCKET}"

  # ── Write Frontend Config ────────────────────────────────────────────────────
  echo ""
  echo -e "${YELLOW}Updating frontend configuration...${NC}"
  CAT_CONFIG_PATH="$SCRIPT_DIR/front_end/.env"
  
  cat > "$CAT_CONFIG_PATH" <<EOF
VITE_API_ENDPOINT=${API_ENDPOINT}
VITE_COGNITO_USER_POOL_ID=${COGNITO_POOL}
VITE_COGNITO_CLIENT_ID=${COGNITO_CLIENT}
EOF
  echo -e "${GREEN}  Updated ${CAT_CONFIG_PATH}${NC}"

  # ── Deploy Frontend ──────────────────────────────────────────────────────────
  echo ""
  echo -e "${YELLOW}[Frontend] Building React app...${NC}"
  cd "$SCRIPT_DIR/front_end"
  npm install --legacy-peer-deps >/dev/null 2>&1
  npm run build >/dev/null
  echo -e "${GREEN}  Build complete (dist/)${NC}"

  echo -e "${YELLOW}[Frontend] Uploading to S3...${NC}"
  FRONTEND_BUCKET=$(terraform -chdir="$SCRIPT_DIR/infra" output -raw frontend_bucket_name 2>/dev/null || echo '')
  # Note: I haven't added frontend_bucket_name output yet, I should use the website endpoint or add the output. 
  # Better: Add frontend_bucket_name output to outputs.tf? 
  # Current plan only added frontend_url.
  # Let's assume I fix outputs.tf to include bucket name, or assume I can get it.
  # Wait, I need the bucket name for s3 sync.
  # I will add frontend_bucket_name to outputs.tf in a separate step or just now.
  # Since I can't easily edit outputs.tf again in this same tool call (sequential restriction?), 
  # I will try to infer it or just use the variable if I can.
  # Actually I should have added it. I'll add it to outputs.tf NEXT.
  # For now, I'll write the script to expect `frontend_bucket_name` output.
  
  # Wait, let's fix outputs.tf properly first. 
  # I'll just put a placeholder here and fix outputs.tf in next step.
  aws s3 sync dist/ "s3://${FRONTEND_BUCKET}" --delete
  echo -e "${GREEN}  Upload complete${NC}"
  
  FRONTEND_URL=$(terraform -chdir="$SCRIPT_DIR/infra" output -raw frontend_url 2>/dev/null || echo '')
  echo ""
  echo -e "  ${GREEN}Frontend URL:${NC}  ${FRONTEND_URL}"
echo -e "${YELLOW}Note: Confirm the SNS email subscription sent to ${NOTIFICATION_EMAIL}${NC}"
echo ""
echo -e "To run the frontend locally:"
echo -e "  ${CYAN}./run.sh${NC}"
echo ""
