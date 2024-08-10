import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { authMiddleware } from "../middlewares/auth";
import { toCamelCase } from "../utils";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
  project: process.env.OPENAI_PROJECT_ID,
});

config();

const supabaseUrl = process.env.SUPABASE_URL || "not-a-real-url";
const supabaseKey = process.env.SUPABASE_KEY || "not-a-real-key";
const supabase = createClient(supabaseUrl, supabaseKey);

export const chatRouter = Router();

chatRouter.get('/', authMiddleware, async (req, res) =>  {
    const { data, error } = await supabase
      .from('bots')
      .select(`
      *,
      messages (
        id,
        text,
        created_at
      )
    `)
      .eq('messages.user_id', req.body.user?.id)
      .order('created_at', { foreignTable: 'messages', ascending: false })
      .limit(1, { foreignTable: 'messages' })

    if (error) return res.status(500).json({ error: error.message });
    const processedData = data.map(bot => {
      return {
        id: bot.id,
        name: bot.name,
        avatarUrl: bot.avatar_url,
        lastMessage: bot.messages && bot.messages.length > 0 ? bot.messages[0] : null
    }})

    return res.json(toCamelCase(processedData));
})

chatRouter.post('/messages', authMiddleware, async (req, res) =>  {
   try {
     const userId = req.body.user?.id;

     if (!userId) return res.status(400).json({ error: "userId is required" });

     const { data, error } = await supabase
       .from("messages")
       .insert({ user_id: userId, text: req.body.text, from_user: true, bot_id: req.body.botId })
       .select("id");

     if (error) return res.status(500).json({ error: error.message });

     const { data : botData, error: botError } = await supabase
        .from("bots")
        .select()
        .eq("id", req.body.botId)

      if (botError) return res.status(500).json({ error: botError.message });

      const botPromt = botData[0].promt

     const completion = await openai.chat.completions.create({
       messages: [
         { role: "system", content: botPromt },
          { role: "user", content: req.body.text },
       ],
       model: "gpt-4o-mini",
     });

     const response = completion.choices[0].message.content

     const { data: dataResponse, error: errorResponse } = await supabase
       .from("messages")
       .insert({ user_id: userId, text: response, from_user: false, bot_id: req.body.botId })
       .select();

     if (errorResponse) return res.status(500).json({ error: errorResponse.message });

     return res.json(toCamelCase(dataResponse[0]))
   } catch (error) {
     console.log(error)
     return res.status(500).json({ error: error });
   }
});

chatRouter.get('/messages', authMiddleware, async (req, res) =>  {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('bot_id', req.query.botId)
      .eq('user_id', req.body.user?.id)
      .order('created_at', { ascending: true })
      .limit(50)

    if (error) return res.status(500).json({ error: error.message });

    return res.json(toCamelCase(data));
})