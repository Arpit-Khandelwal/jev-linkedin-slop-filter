#!/bin/bash
set -a; . "$(dirname "$0")/../.env"; set +a
SAMPLES="$(dirname "$0")/samples.json"
N=$(jq length "$SAMPLES")
printf "%-6s %-6s %-6s %-18s %-6s  %s\n" "LABEL" "SLOP" "CORP" "CATEGORY" "CONF" "TEXT"
printf -- "---------------------------------------------------------------------------\n"
START=$(date +%s)
for i in $(seq 0 $((N-1))); do
  LABEL=$(jq -r ".[$i].label" "$SAMPLES")
  TEXT=$(jq -r ".[$i].text" "$SAMPLES")
  REQ=$(jq -n --arg t "$TEXT" '{
    state: {linkedin_post: $t},
    model: "jev-latest",
    questions: {
      is_slop: {
        type: "noul",
        instructions: "This is a LinkedIn post. Is it low-value engagement-farming content written to a formula rather than to communicate something specific? Formulaic markers include: one-line paragraphs used for dramatic pacing, a manufactured hook, a generic life lesson, a numbered list of platitudes, and an explicit call to comment, repost or save."
      },
      is_corporate_slop: {
        type: "noul",
        instructions: "This is a LinkedIn post. Is it corporate or brand marketing content rather than a person speaking? Markers include: first-person plural on behalf of a company, award or milestone announcements, press-release phrasing, gratitude to the team and customers, and hashtag clusters."
      },
      category: {
        type: "choice",
        instructions: "Classify what kind of LinkedIn post this is.",
        criteria: {
          engagement_bait: "Formulaic post engineered for reach; generic advice, fake vulnerability, or an explicit ask to comment/repost/save",
          humblebrag: "Primarily announces the authors own success or status",
          genuine_update: "A specific, concrete update, experience, or piece of information from the authors actual work or life",
          job_or_notice: "A job posting, event announcement, or practical notice"
        }
      }
    }
  }')
  RES=$(curl -s -X POST https://api.typesafe.ai/v1/systemone \
    -H "Authorization: Bearer $TYPESAFE_API_KEY" \
    -H "Content-Type: application/json" -d "$REQ")
  SLOP=$(echo "$RES" | jq -r '.answers.is_slop.noul // "ERR"')
  CORP=$(echo "$RES" | jq -r '.answers.is_corporate_slop.noul // "ERR"')
  CAT=$(echo "$RES" | jq -r '.answers.category.choice // "ERR"')
  CONF=$(echo "$RES" | jq -r '.answers.category.confidence // "ERR"')
  SNIP=$(echo "$TEXT" | head -c 42 | tr '\n' ' ')
  printf "%-6s %-6s %-6s %-18s %-6s  %s...\n" "$LABEL" "$SLOP" "$CORP" "$CAT" "$CONF" "$SNIP"
done
END=$(date +%s)
echo "---"
echo "$N posts in $((END-START))s"
