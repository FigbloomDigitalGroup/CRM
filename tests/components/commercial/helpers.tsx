import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemberProvider, testMember, ToastProvider, type Member } from "../../../src/ui";
import { resetDemoStore } from "../../../src/ui/screens/commercial/demo/store";
import { resetAudit } from "../../../src/ui/screens/settingsplus/kit";

/** Renders a screen the way the organisation layout would: a member with the given permission keys and the toast host. */
export function renderAs(ui: ReactElement, member: Partial<Member> = {}) {
  resetDemoStore();
  resetAudit();
  return render(
    <MemberProvider value={testMember(member)}>
      <ToastProvider>{ui}</ToastProvider>
    </MemberProvider>,
  );
}

export const MANAGEMENT = {
  userName: "Dev Management",
  roleName: "Management",
  permissionKeys: ["quotes.create", "quotes.approve", "deals.margin", "deals.view.value", "forecast.view.all", "targets.manage", "catalogue.manage", "cadences.manage", "configuration.manage", "api_tokens.manage", "webhooks.manage"],
};

export const SALES = {
  userName: "Dev Sales",
  roleName: "Sales",
  permissionKeys: ["quotes.create", "reporting.view.own", "deals.view.own"],
};

export const DELIVERY = {
  userName: "Dev Delivery",
  roleName: "Delivery",
  permissionKeys: ["reporting.view.own"],
};
