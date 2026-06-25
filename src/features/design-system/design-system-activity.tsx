import { useState } from "react";
import {
  Button,
  Input,
  Card,
  CardContent,
  Empty,
  EmptyTitle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { Check, X, Plus, Paperclip, Trash2 } from "lucide-react";
import { IssuePagePrototypeSection } from "./issue-page-prototype";
import { useI18n } from "../../shared/i18n/i18n";

const TYPE_SAMPLES = {
  headline: "text-[22px] font-semibold leading-[1.2]",
  title: "text-base font-semibold leading-[1.25]",
  bodyStrong: "text-[13px] font-semibold leading-[1.32]",
  body: "text-[13px] font-normal leading-[1.45]",
  label: "text-xs font-semibold leading-[1.35]",
  meta: "text-[11px] font-normal leading-[1.35]",
  mono: "text-xs font-normal leading-[1.45] font-mono",
} as const;

export function DesignSystemActivity() {
  const { messages } = useI18n();
  const [activeSection, setActiveSection] = useState("overview");

  const sections = [
    { id: "overview", label: messages.designSystem.overview },
    { id: "issue-prototype", label: messages.designSystem.issuePrototype },
    { id: "colors", label: messages.designSystem.colors },
    { id: "typography", label: messages.designSystem.typography },
    { id: "buttons", label: messages.designSystem.buttons },
    { id: "inputs", label: messages.designSystem.inputs },
    { id: "cards", label: messages.designSystem.cards },
    { id: "layouts", label: messages.designSystem.layouts },
    { id: "spacing", label: messages.designSystem.spacing },
    { id: "radius", label: messages.designSystem.borderRadius },
  ];

  return (
    <div className="activity-surface" style={{ padding: "24px" }}>
      <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] gap-6 overflow-hidden">
        <nav className="grid grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden border-r py-4">
          <div className="px-4">
            <h2 className="text-base font-semibold leading-[1.25]">
              {messages.designSystem.title}
            </h2>
            <p className="mt-1 text-xs leading-[1.35] text-muted-foreground">
              {messages.designSystem.subtitle}
            </p>
          </div>
          <div className="grid auto-rows-min gap-0.5 overflow-auto px-2">
            {sections.map((section) => (
              <Button
                key={section.id}
                variant="ghost"
                aria-pressed={activeSection === section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "w-full justify-start",
                  activeSection === section.id &&
                    "bg-muted font-semibold text-foreground",
                )}
              >
                {section.label}
              </Button>
            ))}
          </div>
        </nav>

        <div className="overflow-auto pr-2">
          {activeSection === "overview" && <OverviewSection />}
          {activeSection === "issue-prototype" && <IssuePagePrototypeSection />}
          {activeSection === "colors" && <ColorsSection />}
          {activeSection === "typography" && <TypographySection />}
          {activeSection === "buttons" && <ButtonsSection />}
          {activeSection === "inputs" && <InputsSection />}
          {activeSection === "cards" && <CardsSection />}
          {activeSection === "layouts" && <LayoutsSection />}
          {activeSection === "spacing" && <SpacingSection />}
          {activeSection === "radius" && <RadiusSection />}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="m-0 text-[22px] font-semibold leading-[1.2]">{title}</h2>
      <p className="mt-1.5 text-[13px] leading-[1.45] text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function OverviewSection() {
  return (
    <section className="grid gap-6 pb-12">
      <SectionHeader
        title="Overview"
        description="The Local Workbench - Quiet, Compact, Reliable"
      />

      <Card>
        <CardContent className="grid gap-3">
          <h3 className="text-[13px] font-semibold leading-[1.32]">
            Design Principles
          </h3>
          <ul className="m-0 list-disc pl-5">
            <li className="my-1 text-[13px] leading-[1.45]">
              <strong>Trust over Delight:</strong> State must be clear and
              auditable
            </li>
            <li className="my-1 text-[13px] leading-[1.45]">
              <strong>Workbench Density:</strong> Desktop-first panels, hairline
              borders, compact controls
            </li>
            <li className="my-1 text-[13px] leading-[1.45]">
              <strong>Restrained Expression:</strong> Black, white, gray as
              default; color only when needed
            </li>
            <li className="my-1 text-[13px] leading-[1.45]">
              <strong>Clear Boundaries:</strong> Project, Issue, Session,
              Settings must remain visually distinct
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="grid gap-3">
          <h3 className="text-[13px] font-semibold leading-[1.32]">
            Hard Don&apos;ts
          </h3>
          <ul className="m-0 list-disc pl-5">
            <li className="my-1 text-[13px] leading-[1.45]">
              Don&apos;t make marketing pages, SaaS dashboards, or colorful
              column看板
            </li>
            <li className="my-1 text-[13px] leading-[1.45]">
              Don&apos;t use large rounded cards, gradients, or decorative
              shadows
            </li>
            <li className="my-1 text-[13px] leading-[1.45]">
              Don&apos;t make state only available through color (always add
              text)
            </li>
            <li className="my-1 text-[13px] leading-[1.45]">
              Don&apos;t fake &quot;premium&quot; through large fonts or
              excessive spacing
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

function ColorsSection() {
  const neutralsLight = [
    { name: "App White", var: "--color-app", value: "#ffffff" },
    { name: "Surface", var: "--color-surface", value: "#ffffff" },
    { name: "Surface Muted", var: "--color-surface-muted", value: "#f1f2f4" },
    { name: "Border", var: "--color-border", value: "#e3e5e8" },
    { name: "Border Strong", var: "--color-border-strong", value: "#d1d5db" },
    { name: "Text", var: "--color-text", value: "#17181a" },
    { name: "Text Muted", var: "--color-text-muted", value: "#5f6368" },
    { name: "Text Subtle", var: "--color-text-subtle", value: "#8a8f98" },
  ];

  const accents = [
    {
      name: "Accent",
      var: "--color-accent",
      light: "#111111",
      dark: "#ffffff",
    },
    {
      name: "Accent Muted",
      var: "--color-accent-muted",
      light: "#e9eaee",
      dark: "#24262b",
    },
  ];

  const states = [
    { name: "Running", var: "--color-lane-running-marker", value: "#c89000" },
    { name: "Review", var: "--color-lane-review-marker", value: "#249447" },
    {
      name: "Completed",
      var: "--color-lane-completed-marker",
      value: "#1681d9",
    },
    { name: "Danger", var: "--color-danger", value: "#b42318" },
  ];

  const projectColors = [
    { name: "Project Blue", value: "#2563eb" },
    { name: "Project Green", value: "#16a34a" },
    { name: "Project Violet", value: "#7c3aed" },
    { name: "Project Slate", value: "#475569" },
    { name: "Project Lime", value: "#65a30d" },
  ];

  return (
    <section className="grid gap-6 pb-12">
      <SectionHeader
        title="Colors"
        description="The Rarity Rule: Color must be scarce"
      />

      <ColorGroup heading="Neutrals (Light)">
        {neutralsLight.map((color) => (
          <ColorSwatch key={color.name} color={color} />
        ))}
      </ColorGroup>

      <ColorGroup heading="Accents">
        {accents.map((color) => (
          <Card key={color.name}>
            <CardContent className="grid gap-2">
              <div className="flex gap-1">
                <div
                  className="h-12 flex-1 rounded-sm border"
                  style={{ backgroundColor: color.light }}
                />
                <div
                  className="h-12 flex-1 rounded-sm border"
                  style={{ backgroundColor: color.dark }}
                />
              </div>
              <ColorSwatchInfo
                name={color.name}
                value={`${color.light} / ${color.dark}`}
                token={color.var}
              />
            </CardContent>
          </Card>
        ))}
      </ColorGroup>

      <ColorGroup
        heading="State Colors"
        description="Use as small markers, never as full backgrounds or wide strips"
      >
        {states.map((color) => (
          <ColorSwatch key={color.name} color={color} />
        ))}
      </ColorGroup>

      <ColorGroup
        heading="Project Identity Colors"
        description="Only for Project Switcher icons; stable per project"
      >
        {projectColors.map((color) => (
          <Card key={color.name}>
            <CardContent className="grid gap-2">
              <div
                className="h-12 w-full rounded-sm border"
                style={{ backgroundColor: color.value }}
              />
              <ColorSwatchInfo name={color.name} value={color.value} />
            </CardContent>
          </Card>
        ))}
      </ColorGroup>
    </section>
  );
}

function ColorGroup({
  heading,
  description,
  children,
}: {
  heading: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="m-0 text-sm font-semibold leading-[1.3]">{heading}</h3>
        {description && (
          <p className="m-0 text-xs leading-[1.4] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {children}
      </div>
    </div>
  );
}

function ColorSwatch({
  color,
}: {
  color: { name: string; var: string; value: string };
}) {
  return (
    <Card>
      <CardContent className="grid gap-2">
        <div
          className="h-12 w-full rounded-sm border"
          style={{ backgroundColor: color.value }}
        />
        <ColorSwatchInfo
          name={color.name}
          value={color.value}
          token={color.var}
        />
      </CardContent>
    </Card>
  );
}

function ColorSwatchInfo({
  name,
  value,
  token,
}: {
  name: string;
  value: string;
  token?: string;
}) {
  return (
    <div className="grid gap-0.5">
      <div className="text-xs font-semibold leading-[1.35]">{name}</div>
      <div className="text-[11px] leading-[1.35] text-muted-foreground">
        {value}
      </div>
      {token && (
        <div className="font-mono text-[11px] leading-[1.35] text-muted-foreground/70">
          {token}
        </div>
      )}
    </div>
  );
}

function TypographySection() {
  const typeScale = [
    {
      name: "Headline",
      size: "22px",
      weight: "650",
      lineHeight: "1.2",
      usage: "Only for Project Home title",
      className: TYPE_SAMPLES.headline,
    },
    {
      name: "Title",
      size: "16px",
      weight: "650",
      lineHeight: "1.25",
      usage: "Activity-level titles (e.g., Issues)",
      className: TYPE_SAMPLES.title,
    },
    {
      name: "Body Strong",
      size: "13px",
      weight: "650",
      lineHeight: "1.32",
      usage: "Project name, Issue title, dialog title",
      className: TYPE_SAMPLES.bodyStrong,
    },
    {
      name: "Body",
      size: "13px",
      weight: "400",
      lineHeight: "1.45",
      usage: "Default UI copy, button, input",
      className: TYPE_SAMPLES.body,
    },
    {
      name: "Label",
      size: "12px",
      weight: "600",
      lineHeight: "1.35",
      usage: "Field label, section label",
      className: TYPE_SAMPLES.label,
    },
    {
      name: "Meta",
      size: "11px",
      weight: "400",
      lineHeight: "1.35",
      usage: "Timestamp, count, status text",
      className: TYPE_SAMPLES.meta,
    },
    {
      name: "Mono",
      size: "12px",
      weight: "400",
      lineHeight: "1.45",
      usage: "Repo path, command, log, hash, file path",
      className: TYPE_SAMPLES.mono,
    },
  ];

  return (
    <section className="grid gap-6 pb-12">
      <SectionHeader
        title="Typography"
        description="The No Display Rule: No hero type, no display fonts"
      />

      <div className="grid gap-6">
        {typeScale.map((type) => (
          <Card key={type.name}>
            <CardContent className="grid gap-3">
              <div className="grid gap-1">
                <div className="text-xs font-semibold leading-[1.35]">
                  {type.name}
                </div>
                <div className="font-mono text-[11px] leading-[1.35] text-muted-foreground">
                  {type.size} / {type.weight} / {type.lineHeight}
                </div>
                <div className="text-[11px] leading-[1.35] text-muted-foreground/70">
                  {type.usage}
                </div>
              </div>
              <div className="border-t pt-2">
                <span className={type.className}>
                  The quick brown fox jumps over the lazy dog
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Showcase({
  heading,
  description,
  children,
}: {
  heading: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="m-0 text-sm font-semibold leading-[1.3]">{heading}</h3>
          {description && (
            <p className="m-0 text-xs leading-[1.4] text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Demo({
  stacked = false,
  children,
}: {
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 rounded-lg border border-dashed bg-muted p-4",
        stacked && "flex-col items-stretch",
      )}
    >
      {children}
    </div>
  );
}

function ButtonsSection() {
  const { messages } = useI18n();

  return (
    <section className="grid gap-6 pb-12">
      <SectionHeader
        title="Buttons"
        description="Compact square controls, 3px radius"
      />

      <Showcase
        heading="Primary Button"
        description="Current strongest action. Black on white (inverted in dark mode)"
      >
        <Demo>
          <Button>{messages.designSystem.save}</Button>
          <Button disabled>{messages.designSystem.disabled}</Button>
        </Demo>
      </Showcase>

      <Showcase
        heading="Secondary Button"
        description="Cancel, Configure, and disabled follow-up workflow buttons"
      >
        <Demo>
          <Button variant="secondary">{messages.designSystem.cancel}</Button>
          <Button variant="secondary" disabled>
            {messages.designSystem.disabled}
          </Button>
        </Demo>
      </Showcase>

      <Showcase
        heading="Ghost Button"
        description="For subtle actions in panels"
      >
        <Demo>
          <Button variant="ghost">{messages.designSystem.edit}</Button>
          <Button variant="ghost" disabled>
            {messages.designSystem.disabled}
          </Button>
        </Demo>
      </Showcase>

      <Showcase heading="With Icons">
        <Demo>
          <Button>
            <Plus size={16} />
            {messages.designSystem.newIssue}
          </Button>
          <Button variant="secondary">
            <Paperclip size={16} />
            {messages.designSystem.attach}
          </Button>
          <Button variant="ghost">
            <Trash2 size={16} />
            {messages.designSystem.delete}
          </Button>
        </Demo>
      </Showcase>

      <Showcase heading="Small Buttons">
        <Demo>
          <Button size="sm">{messages.designSystem.save}</Button>
          <Button variant="secondary" size="sm">
            {messages.designSystem.cancel}
          </Button>
        </Demo>
      </Showcase>

      <Showcase heading="Icon Only">
        <Demo>
          <Button size="icon" aria-label={messages.designSystem.check}>
            <Check size={16} />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            aria-label={messages.designSystem.closeButton}
          >
            <X size={16} />
          </Button>
        </Demo>
      </Showcase>
    </section>
  );
}

function InputsSection() {
  const { messages } = useI18n();

  return (
    <section className="grid gap-6 pb-12">
      <SectionHeader
        title="Inputs & Fields"
        description="3px radius, 1px hairline border"
      />

      <Showcase heading="Text Input">
        <Demo stacked>
          <Input placeholder={messages.designSystem.enterIssueTitle} />
          <Input value="Create local issue workflow" />
          <Input disabled value={messages.designSystem.cannotEdit} />
        </Demo>
      </Showcase>
    </section>
  );
}

function CardsSection() {
  const { messages } = useI18n();

  return (
    <section className="grid gap-6 pb-12">
      <SectionHeader
        title="Cards"
        description="The Flat Workbench Rule: No card shadows at rest"
      />

      <Showcase heading="Basic Card">
        <Demo stacked>
          <Card style={{ maxWidth: "400px" }}>
            <CardContent className="grid gap-3">
              <div className="grid gap-1">
                <div className="text-base font-medium leading-snug">
                  Card Title
                </div>
                <div className="text-sm text-muted-foreground">
                  Description here
                </div>
              </div>
              <p className="text-[13px] leading-[1.45]">
                Card content goes here. Keep it compact and focused.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary">
                  {messages.designSystem.cancel}
                </Button>
                <Button>{messages.designSystem.confirm}</Button>
              </div>
            </CardContent>
          </Card>
        </Demo>
      </Showcase>

      <Showcase heading="Empty State">
        <Demo stacked>
          <Empty>
            <EmptyTitle>{messages.designSystem.noIssues}</EmptyTitle>
            <Button>
              <Plus size={16} />
              {messages.designSystem.newIssue}
            </Button>
          </Empty>
        </Demo>
      </Showcase>
    </section>
  );
}

function LayoutsSection() {
  const { messages } = useI18n();

  return (
    <section className="grid gap-6 pb-12">
      <SectionHeader
        title="Layouts"
        description="Template systems for consistent page structure"
      />

      <Showcase heading="Page Layout">
        <Demo stacked>
          <div className="rounded-[var(--radius-card)] border p-4">
            <div className="mb-2 text-xs text-muted-foreground">
              {`<PageLayout title="${messages.designSystem.myPage}" subtitle="${messages.designSystem.subtitleHere}">`}
            </div>
            <div className="rounded-[var(--radius-card)] border border-dashed p-4">
              <div className="mb-4 flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <h3 className="m-0 text-[22px] font-semibold leading-[1.2]">
                    {messages.designSystem.myPage}
                  </h3>
                  <p className="mt-2 text-[13px] leading-[1.45] text-muted-foreground">
                    {messages.designSystem.subtitleHere}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary">
                    {messages.designSystem.action}
                  </Button>
                  <Button>{messages.designSystem.primary}</Button>
                </div>
              </div>
              <div className="text-[13px] text-muted-foreground">
                {messages.designSystem.pageContent}
              </div>
            </div>
          </div>
        </Demo>
      </Showcase>
    </section>
  );
}

function SpacingSection() {
  const spacing = [
    { name: "xs", value: "4px" },
    { name: "sm", value: "8px" },
    { name: "md", value: "12px" },
    { name: "lg", value: "16px" },
    { name: "xl", value: "22px" },
    { name: "xxl", value: "32px" },
  ];

  return (
    <section className="grid gap-6 pb-12">
      <SectionHeader
        title="Spacing"
        description="Compact, purposeful spacing system"
      />

      <div className="grid gap-4">
        {spacing.map((space) => (
          <Card key={space.name}>
            <CardContent className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-4">
              <div className="text-xs font-semibold leading-[1.35]">
                {space.name} ({space.value})
              </div>
              <div
                className="rounded-sm border bg-muted"
                style={{
                  width: space.value,
                  height: space.value,
                  minWidth: "48px",
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function RadiusSection() {
  const radii = [
    { name: "control", value: "3px", usage: "Buttons, inputs" },
    { name: "card", value: "5px", usage: "Project cards, issue cards" },
    { name: "dialog", value: "7px", usage: "Modal dialogs" },
    { name: "icon", value: "7px", usage: "Project icons" },
  ];

  return (
    <section className="grid gap-6 pb-12">
      <SectionHeader
        title="Border Radius"
        description="Subtle, minimal rounding"
      />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {radii.map((radius) => (
          <Card key={radius.name}>
            <CardContent className="grid gap-3">
              <div
                className="h-16 w-16 border bg-muted"
                style={{ borderRadius: radius.value }}
              />
              <div className="grid gap-0.5">
                <div className="text-xs font-semibold leading-[1.35]">
                  {radius.name}
                </div>
                <div className="font-mono text-[11px] leading-[1.35] text-muted-foreground">
                  {radius.value}
                </div>
                <div className="text-[11px] leading-[1.35] text-muted-foreground/70">
                  {radius.usage}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
