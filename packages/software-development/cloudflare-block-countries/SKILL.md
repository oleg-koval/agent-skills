---
name: cloudflare-block-countries
description: 'Block specific countries via Cloudflare WAF Custom Rules using the Cloudflare API. Use when user wants to geo-block traffic, block countries in Cloudflare, set up WAF country rules, or mentions blocking regions. Handles both creating new rulesets and updating existing ones.'
license: MIT
allowed-tools: Bash
compatibility: Codex, Claude Code, Cursor, GitHub Copilot, Windsurf, Kiro, and other Agent Skills compatible tools. Requires curl and jq.
metadata:
  author: Oleg Koval
  tags:
    - cloudflare
    - waf
    - security
    - geo-blocking
    - firewall
---

# Cloudflare Country Block via WAF Custom Rules

Block traffic from specific countries using Cloudflare WAF Custom Rules and the Cloudflare API.

## Prerequisites

- Cloudflare API Token with `Zone:Rulesets:Edit` permission
- Zone ID for the target domain
- `curl` and `jq` installed

## Workflow

### 1. Get Zone IDs

```bash
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones?account.id=YOUR_ACCOUNT_ID&status=active" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.result[] | {name: .name, id: .id}'
```

### 2. Check Existing Custom Firewall Rulesets

```bash
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/rulesets" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" | \
  jq '.result[] | select(.phase == "http_request_firewall_custom")'
```

If the output is empty — no existing ruleset. Go to **3a**. If a ruleset exists, note its `id` and go to **3b**.

### 3a. Create NEW Ruleset with Block Rule

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/rulesets" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "default",
    "description": "WAF Custom Rules",
    "kind": "zone",
    "phase": "http_request_firewall_custom",
    "rules": [
      {
        "action": "block",
        "description": "Block traffic from sanctioned countries",
        "enabled": true,
        "expression": "(ip.src.country in {\"RU\" \"BY\" \"IR\" \"KP\"})"
      }
    ]
  }' | jq '.success'
```

### 3b. Update EXISTING Ruleset

```bash
curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/rulesets/RULESET_ID" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "description": "WAF Custom Rules",
    "rules": [
      {
        "action": "block",
        "description": "Block traffic from sanctioned countries",
        "enabled": true,
        "expression": "(ip.src.country in {\"RU\" \"BY\" \"IR\" \"KP\"})"
      }
    ]
  }' | jq '.success'
```

### 4. Verify the Rule is Active

```bash
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/rulesets/RULESET_ID" \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.result.rules'
```

## Country Codes Reference

| Code | Country |
|------|---------|
| `RU` | Russia |
| `BY` | Belarus |
| `IR` | Iran |
| `KP` | North Korea |
| `CN` | China |
| `CU` | Cuba |
| `SY` | Syria |
| `VE` | Venezuela |

## WAF Expression Examples

```
# Block multiple countries
(ip.src.country in {"RU" "BY" "IR" "KP"})

# Block country + specific ASN
(ip.src.country eq "RU") or (ip.geoip.asnum eq 12345)

# Block all except allowlisted IPs
(ip.src.country in {"RU" "BY"}) and not (ip.src in {1.2.3.4/32})
```

## Multi-Zone Script

To apply the same block rule across multiple zones:

```bash
#!/usr/bin/env bash
API_TOKEN="YOUR_API_TOKEN"
ZONES=("ZONE_ID_1" "ZONE_ID_2" "ZONE_ID_3")
EXPRESSION='(ip.src.country in {"RU" "BY" "IR" "KP"})'

for ZONE_ID in "${ZONES[@]}"; do
  EXISTING=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" | \
    jq -r '.result[] | select(.phase == "http_request_firewall_custom") | .id')

  if [ -z "$EXISTING" ]; then
    METHOD="POST"
    URL="https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets"
    DATA=$(jq -n --arg expr "$EXPRESSION" '{
      name: "default", description: "WAF Custom Rules",
      kind: "zone", phase: "http_request_firewall_custom",
      rules: [{action: "block", description: "Block sanctioned countries", enabled: true, expression: $expr}]
    }')
  else
    METHOD="PUT"
    URL="https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/$EXISTING"
    DATA=$(jq -n --arg expr "$EXPRESSION" '{
      description: "WAF Custom Rules",
      rules: [{action: "block", description: "Block sanctioned countries", enabled: true, expression: $expr}]
    }')
  fi

  RESULT=$(curl -s -X "$METHOD" "$URL" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$DATA" | jq '.success')

  echo "Zone $ZONE_ID: $RESULT"
done
```

## Notes

- `PUT` on an existing ruleset **replaces all rules** in it. Include all rules in the payload if the ruleset already has other rules.
- WAF Custom Rules require a Cloudflare plan that supports rulesets (Free includes basic WAF; Pro/Business/Enterprise for full custom rules).
- Changes are applied globally within seconds; no cache purge needed.
