export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Hello");
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (!event.source?.userId) continue;

      const userId = event.source.userId;
      const nowIso = new Date().toISOString();
      const oneMinuteAgoIso = new Date(Date.now() - 1 * 60 * 1000).toISOString();

      // ① このユーザーの最新 collecting inquiry を1件だけ探す
      const inquiryRes = await fetch(
        `${SUPABASE_URL}/rest/v1/inquiries?user_id=eq.${userId}&status=eq.collecting&order=created_at.desc&limit=1`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      const inquiries = await inquiryRes.json();
      let inquiryId = null;

      // ② 1分以内なら既存 inquiry を再利用、そうでなければ新規作成
      if (inquiries.length > 0) {
        const latestInquiry = inquiries[0];
        const baseTime = latestInquiry.last_message_at || latestInquiry.created_at;

        if (baseTime && new Date(baseTime).getTime() >= new Date(oneMinuteAgoIso).getTime()) {
          inquiryId = latestInquiry.id;
        }
      }

      if (!inquiryId) {
        const createRes = await fetch(`${SUPABASE_URL}/rest/v1/inquiries`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            user_id: userId,
            status: "collecting",
            last_message_at: nowIso,
          }),
        });

        const newInquiry = await createRes.json();
        inquiryId = newInquiry[0].id;
      }

      // ③ テキスト保存
      if (event.message.type === "text") {
        await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
          body: JSON.stringify({
            inquiry_id: inquiryId,
            type: "text",
            text: event.message.text || null,
            image_url: null,
          }),
        });
      }

      // ④ 画像保存
      if (event.message.type === "image") {
        const messageId = event.message.id;

        // LINEから画像本体取得
        const imageRes = await fetch(
          `https://api-data.line.me/v2/bot/message/${messageId}/content`,
          {
            headers: {
              Authorization: `Bearer ${LINE_TOKEN}`,
            },
          }
        );

        const arrayBuffer = await imageRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const fileName = `${Date.now()}-${messageId}.jpg`;

        // Supabase Storage に保存
        await fetch(
          `${SUPABASE_URL}/storage/v1/object/line-images/${fileName}`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "image/jpeg",
              "x-upsert": "true",
            },
            body: buffer,
          }
        );

        const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/line-images/${fileName}`;

        // messages テーブルに保存
        await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
          body: JSON.stringify({
            inquiry_id: inquiryId,
            type: "image",
            text: null,
            image_url: imageUrl,
          }),
        });
      }

      // ⑤ 必ず last_message_at を更新
      await fetch(`${SUPABASE_URL}/rest/v1/inquiries?id=eq.${inquiryId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          last_message_at: nowIso,
        }),
      });
    }

    // 重要: 今はすぐ返信しない
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("webhook error:", error);
    return res.status(200).json({ ok: false, error: error.message });
  }
}
