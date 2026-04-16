export default function handler(req, res) {
  if (req.method === "POST") {
    console.log("LINEから受信:", req.body);
    return res.status(200).json({ status: "OK" });
  }
  return res.status(200).send("Hello");
}
