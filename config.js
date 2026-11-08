// 填入 Supabase 專案資料（Project Settings → API Keys）。
// 這裡放的是 Publishable key，本來就是公開用的，資料安全由 supabase/schema.sql 的權限規則負責。
// 絕對不要把 Secret key（sb_secret_ 開頭）或 service_role key 放在這裡。
window.APP_CONFIG = {
  SUPABASE_URL: "https://ixrcycistjwoyhdwcufs.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_g8pMLBiP32dkWAW9kjhxEg_leWGNeLJ"
};
