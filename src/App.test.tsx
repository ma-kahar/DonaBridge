import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import "./i18n";

describe("App", () => {
  it("renders the Dona Bridge empty state and opens Add Account modal", () => {
    render(<App />);
    expect(screen.getByText("Dona Bridge")).toBeInTheDocument();
    expect(screen.getByText(/Add your first WhatsApp account/i)).toBeInTheDocument();

    const addButtons = screen.getAllByRole("button", { name: /Add account/i });
    fireEvent.click(addButtons[0]);
    expect(screen.getByLabelText(/Account name/i)).toBeInTheDocument();
  });

  it("toggles the CRM and Copilot drawer from the dock", () => {
    render(<App />);
    const crmButton = screen.getByRole("button", { name: "CRM" });
    fireEvent.click(crmButton);
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.getByText("AI Copilot")).toBeInTheDocument();
  });

  it("opens Settings modal and Lock screen", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("AI Provider")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Lock app" }));
    expect(await screen.findByText("Dona Bridge is locked")).toBeInTheDocument();
  });
});
