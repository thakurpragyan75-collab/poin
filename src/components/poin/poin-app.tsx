import { Hunt } from "@/components/poin/hunt";
import { Launch } from "@/components/poin/launch";
import { usePoin } from "@/lib/poin/store";

export function PoinApp() {
  const screen = usePoin((s) => s.screen);
  return screen === "launch" ? <Launch /> : <Hunt />;
}
