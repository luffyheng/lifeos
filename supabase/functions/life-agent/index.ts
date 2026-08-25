import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type" };
const validCategories = ["career","health","relationships","life","growth","finance","freedom"];

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:cors });
  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured");
    const body = await req.json();
    if (!body.message || typeof body.message !== "string" || body.message.length > 12000) return json({ error:"Invalid message" },400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const token = req.headers.get("Authorization")?.replace("Bearer ","") || "";
    const supabase = createClient(supabaseUrl, anonKey, { global:{ headers:{ Authorization:`Bearer ${token}` } } });
    const { data:{ user } } = await supabase.auth.getUser(token);
    if (!user) return json({ error:"Authentication required" },401);

    const instructions = `You are Life Agent, a thoughtful long-term second brain, coach, and strategist. Reply in the user's language. Be warm, concise, specific, and never a yes-man. Connect the current issue to long-term balance across career, health, relationships, life/values, growth, finance, and freedom/happiness. Ask at most one useful follow-up question. Use Markdown sparingly and avoid unnecessary bold text. Do not diagnose medical conditions or give personalized financial instructions. Return JSON matching the schema. Extract only durable, user-specific memories; never infer sensitive facts. Category keys must be from: ${validCategories.join(", ")}.`;
    const input = [
      ...(body.recent_messages || []).slice(-10).map((m:any)=>({ role:m.role, content:m.content })),
      { role:"user", content:`Current context: ${JSON.stringify(body.context || {})}\n\nUser message: ${body.message}` }
    ];
    const ai = await fetch("https://api.openai.com/v1/responses", {
      method:"POST", headers:{ "Authorization":`Bearer ${openaiKey}`, "Content-Type":"application/json" },
      body:JSON.stringify({
        model:Deno.env.get("OPENAI_MODEL") || "gpt-5.4-mini", instructions, input, store:false,
        text:{ format:{ type:"json_schema", name:"life_agent_reply", strict:true, schema:{
          type:"object", additionalProperties:false, required:["assistant","tags","memories","signals"], properties:{
            assistant:{ type:"string" }, tags:{ type:"array", items:{ type:"string" }, maxItems:4 },
            memories:{ type:"array", items:{ type:"string" }, maxItems:3 },
            signals:{ type:"array", maxItems:5, items:{ type:"object", additionalProperties:false, required:["category","sentiment","importance"], properties:{ category:{ type:"string", enum:validCategories }, sentiment:{ type:"number", minimum:-1, maximum:1 }, importance:{ type:"integer", minimum:1, maximum:5 } } } }
          }
        } } }
      })
    });
    if (!ai.ok) throw new Error(`OpenAI request failed: ${ai.status}`);
    const response = await ai.json();
    const result = JSON.parse(response.output_text || response.output?.flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==="output_text")?.text || "{}");

    {
      const { data:conversation } = await supabase.from("conversations").select("id").eq("user_id",user.id).order("updated_at",{ascending:false}).limit(1).maybeSingle();
      let conversationId=conversation?.id;
      if (!conversationId) { const { data }=await supabase.from("conversations").insert({user_id:user.id,title:"Life Agent"}).select("id").single(); conversationId=data?.id; }
      if (conversationId) await supabase.from("messages").insert([
        { conversation_id:conversationId,user_id:user.id,role:"user",content:body.message,tags:result.tags },
        { conversation_id:conversationId,user_id:user.id,role:"assistant",content:result.assistant,tags:result.tags,metadata:{signals:result.signals} }
      ]);
      for (const content of result.memories || []) await supabase.from("memories").upsert({ user_id:user.id, content, category:result.signals?.[0]?.category || "life", source:"chat", confidence:.8 },{onConflict:"user_id,content"});
    }
    return json(result,200);
  } catch (error) { console.error(error); return json({ error:error instanceof Error?error.message:"Unexpected error" },500); }
});

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}})}

