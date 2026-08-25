import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type" };
const validCategories = ["career","health","relationships","life","growth","finance","freedom"];

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:cors });
  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const token = req.headers.get("Authorization")?.replace("Bearer ","") || "";
    const supabase = createClient(supabaseUrl, anonKey, { global:{ headers:{ Authorization:`Bearer ${token}` } } });
    const { data:{ user } } = await supabase.auth.getUser(token);
    if (!user) return json({ error:"Authentication required" },401);
    if (user.email?.toLowerCase() !== "luffyheng@gmail.com") return json({ error:"This Life Agent is private" },403);

    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form=await req.formData();
      const audio=form.get("audio");
      if (!(audio instanceof File) || !audio.size || audio.size > 25 * 1024 * 1024) return json({error:"Invalid or oversized audio"},400);
      const transcriptionForm=new FormData();
      transcriptionForm.append("file",audio,audio.name || "recording.webm");
      transcriptionForm.append("model","gpt-4o-mini-transcribe");
      transcriptionForm.append("response_format","json");
      const transcription=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${openaiKey}`},body:transcriptionForm});
      const transcriptionResult=await transcription.json();
      if (!transcription.ok) throw new Error(transcriptionResult?.error?.message || `Transcription failed: ${transcription.status}`);
      return json({text:transcriptionResult.text || ""},200);
    }

    const body = await req.json();
    if (!body.message || typeof body.message !== "string" || body.message.length > 12000) return json({ error:"Invalid message" },400);

    let conversationId = typeof body.conversation_id === "string" ? body.conversation_id : null;
    let conversationTitle = "";
    let conversationWasNew = false;
    if (conversationId) {
      const { data:conversation,error } = await supabase.from("conversations").select("id,title").eq("id",conversationId).eq("user_id",user.id).maybeSingle();
      if (error || !conversation) return json({ error:"Conversation not found" },404);
      conversationTitle=conversation.title;
    } else {
      conversationTitle=body.message.replace(/\s+/g," ").trim().slice(0,60) || "新的对话";
      const { data:conversation,error } = await supabase.from("conversations").insert({user_id:user.id,title:conversationTitle}).select("id,title").single();
      if (error || !conversation) throw new Error(error?.message || "Could not create conversation");
      conversationId=conversation.id;
      conversationTitle=conversation.title;
      conversationWasNew=true;
    }

    const [{ data:history },{ data:cloudMemories },{ data:cloudGoals },{ data:recentHealth }] = await Promise.all([
      supabase.from("messages").select("role,content,created_at").eq("conversation_id",conversationId).order("created_at",{ascending:false}).limit(20),
      supabase.from("memories").select("content,category,confidence").eq("user_id",user.id).eq("active",true).order("updated_at",{ascending:false}).limit(50),
      supabase.from("goals").select("title,category,status,progress,target_date,why").eq("user_id",user.id).eq("status","active").order("updated_at",{ascending:false}).limit(50),
      supabase.from("daily_checkins").select("checkin_date,energy,mood,sleep_hours,exercise_minutes,note").eq("user_id",user.id).order("checkin_date",{ascending:false}).limit(14)
    ]);

    const requestedTimeZone=typeof body.client_context?.time_zone === "string" ? body.client_context.time_zone : "Asia/Kuala_Lumpur";
    let userTimeZone="Asia/Kuala_Lumpur";
    try { new Intl.DateTimeFormat("en",{timeZone:requestedTimeZone}).format(); userTimeZone=requestedTimeZone; } catch { /* keep safe default */ }
    const currentTime = new Intl.DateTimeFormat("zh-MY",{timeZone:userTimeZone,dateStyle:"full",timeStyle:"medium",hour12:false}).format(new Date());
    const instructions = `You are Life Agent, a thoughtful long-term second brain, coach, and strategist. Reply in the user's language. Be warm, concise, specific, and never a yes-man. Connect the current issue to long-term balance across career, health, relationships, life/values, growth, finance, and freedom/happiness. Ask at most one useful follow-up question. Use Markdown sparingly and avoid unnecessary bold text. Do not diagnose medical conditions or give personalized financial instructions. Return JSON matching the schema. Extract only durable, user-specific memories; never infer sensitive facts. Category keys must be from: ${validCategories.join(", ")}. The verified current date and time is ${currentTime} in ${userTimeZone}. When asked for the current date or time, answer directly from this value. If the user states concrete health facts such as hours slept, energy or mood from 1-10, or exercise duration, populate health_checkin using only the facts provided and null for missing fields. Otherwise health_checkin must be null.`;
    const input = [
      ...[...(history || [])].reverse().map((m:any)=>({ role:m.role, content:m.content })),
      { role:"user", content:`Long-term memories: ${JSON.stringify(cloudMemories || [])}\nActive goals: ${JSON.stringify(cloudGoals || [])}\nRecent health records: ${JSON.stringify(recentHealth || [])}\n\nUser message: ${body.message}` }
    ];
    const ai = await fetch("https://api.openai.com/v1/responses", {
      method:"POST", headers:{ "Authorization":`Bearer ${openaiKey}`, "Content-Type":"application/json" },
      body:JSON.stringify({
        model:Deno.env.get("OPENAI_MODEL") || "gpt-5.4-mini", instructions, input, store:false,
        text:{ format:{ type:"json_schema", name:"life_agent_reply", strict:true, schema:{
          type:"object", additionalProperties:false, required:["assistant","tags","memories","signals","health_checkin"], properties:{
            assistant:{ type:"string" }, tags:{ type:"array", items:{ type:"string" }, maxItems:4 },
            memories:{ type:"array", items:{ type:"string" }, maxItems:3 },
            signals:{ type:"array", maxItems:5, items:{ type:"object", additionalProperties:false, required:["category","sentiment","importance"], properties:{ category:{ type:"string", enum:validCategories }, sentiment:{ type:"number", minimum:-1, maximum:1 }, importance:{ type:"integer", minimum:1, maximum:5 } } } },
            health_checkin:{ anyOf:[
              { type:"null" },
              { type:"object", additionalProperties:false, required:["checkin_date","sleep_hours","energy","mood","exercise_minutes","note"], properties:{
                checkin_date:{ type:"string" },
                sleep_hours:{ anyOf:[{type:"number",minimum:0,maximum:24},{type:"null"}] },
                energy:{ anyOf:[{type:"integer",minimum:1,maximum:10},{type:"null"}] },
                mood:{ anyOf:[{type:"integer",minimum:1,maximum:10},{type:"null"}] },
                exercise_minutes:{ anyOf:[{type:"integer",minimum:0,maximum:1440},{type:"null"}] },
                note:{ anyOf:[{type:"string"},{type:"null"}] }
              } }
            ] }
          }
        } } }
      })
    });
    if (!ai.ok) throw new Error(`OpenAI request failed: ${ai.status}`);
    const response = await ai.json();
    const result = JSON.parse(response.output_text || response.output?.flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==="output_text")?.text || "{}");

    const { error:messageError } = await supabase.from("messages").insert([
      { conversation_id:conversationId,user_id:user.id,role:"user",content:body.message,tags:[],metadata:{} },
      { conversation_id:conversationId,user_id:user.id,role:"assistant",content:result.assistant,tags:result.tags,metadata:{signals:result.signals} }
    ]);
    if (messageError) throw new Error(messageError.message);
    for (const content of result.memories || []) {
      const { error } = await supabase.from("memories").upsert({ user_id:user.id, content, category:result.signals?.[0]?.category || "life", source:"chat", confidence:.8, updated_at:new Date().toISOString() },{onConflict:"user_id,content"});
      if (error) console.error("Memory sync failed",error);
    }
    if (result.health_checkin) {
      const health=result.health_checkin;
      const { data:existing } = await supabase.from("daily_checkins").select("energy,mood,sleep_hours,exercise_minutes,note").eq("user_id",user.id).eq("checkin_date",health.checkin_date).maybeSingle();
      const record:any={user_id:user.id,checkin_date:health.checkin_date,updated_at:new Date().toISOString(),...(existing || {})};
      for (const key of ["energy","mood","sleep_hours","exercise_minutes","note"]) if (health[key] !== null) record[key]=health[key];
      const { error:healthError } = await supabase.from("daily_checkins").upsert(record,{onConflict:"user_id,checkin_date"});
      if (healthError) console.error("Health sync failed",healthError);
    }
    await supabase.from("conversations").update({title:conversationTitle,updated_at:new Date().toISOString()}).eq("id",conversationId).eq("user_id",user.id);
    return json({...result,conversation_id:conversationId,conversation_title:conversationTitle,conversation_created:conversationWasNew},200);
  } catch (error) { console.error(error); return json({ error:error instanceof Error?error.message:"Unexpected error" },500); }
});

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}})}
