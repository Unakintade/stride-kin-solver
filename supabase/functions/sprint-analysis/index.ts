import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { analysisData } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are an elite sprint biomechanics coach analyzing data from a video-based motion capture system (BlazePose + MuJoCo inverse dynamics).

Your role: Identify specific biomechanical issues that would prevent this athlete from reaching world-class sprinting performance, and provide actionable recommendations to address them.

Important context about the data source:
- This data comes from camera-based pose estimation, NOT wearable IMUs
- Some values may be imprecise or noisy due to video-based capture limitations (motion blur, occlusion, low frame rate)
- Ignore any values that seem physically improbable (e.g., extreme torques, impossible joint angles, GRF spikes that don't match gait phase) — these are likely artifacts of the capture method, not real biomechanical issues
- Focus on consistent patterns and trends rather than individual frame outliers

Structure your response as:
1. **Overview** — Brief summary of the movement quality observed
2. **Key Issues** — Numbered list of specific biomechanical limiters, each with:
   - What the data shows
   - Why it matters for sprint performance
   - What world-class sprinters typically exhibit for comparison
3. **Recommendations** — Prioritized, actionable drills or corrections for each issue
4. **Data Quality Notes** — Brief mention of any values you chose to disregard as likely capture artifacts

Keep the analysis specific and data-driven. Reference actual values from the data where relevant. Be direct — this is for a serious athlete or coach.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Here is the biomechanical analysis data from the sprint capture:\n\n${analysisData}`,
            },
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds at Settings > Workspace > Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("sprint-analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
