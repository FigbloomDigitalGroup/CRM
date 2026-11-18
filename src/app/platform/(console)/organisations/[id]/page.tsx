import { OrgDetail } from "@/ui/screens/platform";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrgDetail id={id} />;
}
