import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const acceptLanguage = (await headers()).get("accept-language")?.toLowerCase() ?? "";
  redirect(acceptLanguage.includes("zh") ? "/zh" : "/en");
}
