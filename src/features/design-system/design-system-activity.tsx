import { useState } from "react";
import {
  Button,
  Input,
  Textarea,
  Label,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  Separator,
  Empty,
} from "@/components/ui";
import {
  Check,
  X,
  Plus,
  Paperclip,
  Trash2,
  Inbox,
} from "lucide-react";

export function DesignSystemActivity() {
  const [activeSection, setActiveSection] = useState("overview");

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "colors", label: "Colors" },
    { id: "typography", label: "Typography" },
    { id: "buttons", label: "Buttons" },
    { id: "inputs", label: "Inputs" },
    { id: "badges", label: "Badges" },
    { id: "cards", label: "Cards" },
    { id: "layouts", label: "Layouts" },
    { id: "spacing", label: "Spacing" },
    { id: "radius", label: "Border Radius" },
  ];

  return (
    <div className="activity-surface" style={{ padding: "24px" }}>
      <div className="design-system-layout">
        <div className="design-system-nav">
          <div className="design-system-nav-header">
            <h2>Design System</h2>
            <p>RedWhisk UI Component Library</p>
          </div>
          <nav className="design-system-nav-list">
            {sections.map((section) => (
              <button
                key={section.id}
                className={`design-system-nav-item ${
                  activeSection === section.id ? "active" : ""
                }`}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="design-system-content">
          {activeSection === "overview" && <OverviewSection />}
          {activeSection === "colors" && <ColorsSection />}
          {activeSection === "typography" && <TypographySection />}
          {activeSection === "buttons" && <ButtonsSection />}
          {activeSection === "inputs" && <InputsSection />}
          {activeSection === "badges" && <BadgesSection />}
          {activeSection === "cards" && <CardsSection />}
          {activeSection === "layouts" && <LayoutsSection />}
          {activeSection === "spacing" && <SpacingSection />}
          {activeSection === "radius" && <RadiusSection />}
        </div>
      </div>
    </div>
  );
}

function OverviewSection() {
  return (
    <div className="design-section">
      <div className="design-section-header">
        <h2>Overview</h2>
        <p>The Local Workbench - Quiet, Compact, Reliable</p>
      </div>

      <div className="design-note">
        <h3>Design Principles</h3>
        <ul>
          <li>
            <strong>Trust over Delight:</strong> State must be clear and auditable
          </li>
          <li>
            <strong>Workbench Density:</strong> Desktop-first panels, hairline borders, compact controls
          </li>
          <li>
            <strong>Restrained Expression:</strong> Black, white, gray as default; color only when needed
          </li>
          <li>
            <strong>Clear Boundaries:</strong> Project, Issue, Session, Settings must remain visually distinct
          </li>
        </ul>
      </div>

      <div className="design-note design-note--warning">
        <h3>Hard Don'ts</h3>
        <ul>
          <li>Don't make marketing pages, SaaS dashboards, or colorful column看板</li>
          <li>Don't use large rounded cards, gradients, or decorative shadows</li>
          <li>Don't make state only available through color (always add text)</li>
          <li>Don't fake "premium" through large fonts or excessive spacing</li>
        </ul>
      </div>
    </div>
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
    { name: "Accent", var: "--color-accent", light: "#111111", dark: "#ffffff" },
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
    { name: "Completed", var: "--color-lane-completed-marker", value: "#1681d9" },
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
    <div className="design-section">
      <div className="design-section-header">
        <h2>Colors</h2>
        <p>The Rarity Rule: Color must be scarce</p>
      </div>

      <div className="color-section">
        <h3>Neutrals (Light)</h3>
        <div className="color-grid">
          {neutralsLight.map((color) => (
            <div key={color.name} className="color-swatch">
              <div
                className="color-swatch-box"
                style={{ backgroundColor: color.value }}
              />
              <div className="color-swatch-info">
                <div className="color-swatch-name">{color.name}</div>
                <div className="color-swatch-value">{color.value}</div>
                <div className="color-swatch-var">{color.var}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="color-section">
        <h3>Accents</h3>
        <div className="color-grid">
          {accents.map((color) => (
            <div key={color.name} className="color-swatch">
              <div className="color-swatch-duo">
                <div
                  className="color-swatch-box"
                  style={{ backgroundColor: color.light }}
                />
                <div
                  className="color-swatch-box"
                  style={{ backgroundColor: color.dark }}
                />
              </div>
              <div className="color-swatch-info">
                <div className="color-swatch-name">{color.name}</div>
                <div className="color-swatch-value">
                  {color.light} / {color.dark}
                </div>
                <div className="color-swatch-var">{color.var}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="color-section">
        <h3>State Colors</h3>
        <p>Use as small markers, never as full backgrounds or wide strips</p>
        <div className="color-grid">
          {states.map((color) => (
            <div key={color.name} className="color-swatch">
              <div
                className="color-swatch-box"
                style={{ backgroundColor: color.value }}
              />
              <div className="color-swatch-info">
                <div className="color-swatch-name">{color.name}</div>
                <div className="color-swatch-value">{color.value}</div>
                <div className="color-swatch-var">{color.var}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="color-section">
        <h3>Project Identity Colors</h3>
        <p>Only for Project Switcher icons; stable per project</p>
        <div className="color-grid">
          {projectColors.map((color) => (
            <div key={color.name} className="color-swatch">
              <div
                className="color-swatch-box"
                style={{ backgroundColor: color.value }}
              />
              <div className="color-swatch-info">
                <div className="color-swatch-name">{color.name}</div>
                <div className="color-swatch-value">{color.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
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
      className: "design-type-headline",
    },
    {
      name: "Title",
      size: "16px",
      weight: "650",
      lineHeight: "1.25",
      usage: "Activity-level titles (e.g., Issues)",
      className: "design-type-title",
    },
    {
      name: "Body Strong",
      size: "13px",
      weight: "650",
      lineHeight: "1.32",
      usage: "Project name, Issue title, dialog title",
      className: "design-type-body-strong",
    },
    {
      name: "Body",
      size: "13px",
      weight: "400",
      lineHeight: "1.45",
      usage: "Default UI copy, button, input",
      className: "design-type-body",
    },
    {
      name: "Label",
      size: "12px",
      weight: "600",
      lineHeight: "1.35",
      usage: "Field label, section label",
      className: "design-type-label",
    },
    {
      name: "Meta",
      size: "11px",
      weight: "400",
      lineHeight: "1.35",
      usage: "Timestamp, count, status text",
      className: "design-type-meta",
    },
    {
      name: "Mono",
      size: "12px",
      weight: "400",
      lineHeight: "1.45",
      usage: "Repo path, command, log, hash, file path",
      className: "design-type-mono",
    },
  ];

  return (
    <div className="design-section">
      <div className="design-section-header">
        <h2>Typography</h2>
        <p>The No Display Rule: No hero type, no display fonts</p>
      </div>

      <div className="type-scale">
        {typeScale.map((type) => (
          <div key={type.name} className="type-scale-item">
            <div className="type-scale-meta">
              <div className="type-scale-name">{type.name}</div>
              <div className="type-scale-details">
                {type.size} / {type.weight} / {type.lineHeight}
              </div>
              <div className="type-scale-usage">{type.usage}</div>
            </div>
            <div className="type-scale-sample">
              <span className={type.className}>
                The quick brown fox jumps over the lazy dog
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ButtonsSection() {
  return (
    <div className="design-section">
      <div className="design-section-header">
        <h2>Buttons</h2>
        <p>Compact square controls, 3px radius</p>
      </div>

      <div className="component-showcase">
        <h3>Primary Button</h3>
        <p>Current strongest action. Black on white (inverted in dark mode)</p>
        <div className="component-demo">
          <Button>Save</Button>
          <Button disabled>Disabled</Button>
        </div>
      </div>

      <div className="component-showcase">
        <h3>Secondary Button</h3>
        <p>Cancel, Configure, and disabled follow-up workflow buttons</p>
        <div className="component-demo">
          <Button variant="secondary">Cancel</Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </div>
      </div>

      <div className="component-showcase">
        <h3>Ghost Button</h3>
        <p>For subtle actions in panels</p>
        <div className="component-demo">
          <Button variant="ghost">Edit</Button>
          <Button variant="ghost" disabled>
            Disabled
          </Button>
        </div>
      </div>

      <div className="component-showcase">
        <h3>With Icons</h3>
        <div className="component-demo">
          <Button>
            <Plus size={16} />
            New Issue
          </Button>
          <Button variant="secondary">
            <Paperclip size={16} />
            Attach
          </Button>
          <Button variant="ghost">
            <Trash2 size={16} />
            Delete
          </Button>
        </div>
      </div>

      <div className="component-showcase">
        <h3>Small Buttons</h3>
        <div className="component-demo">
          <Button size="sm">Save</Button>
          <Button variant="secondary" size="sm">Cancel</Button>
        </div>
      </div>

      <div className="component-showcase">
        <h3>Icon Only</h3>
        <div className="component-demo">
          <Button size="icon" aria-label="Check">
            <Check size={16} />
          </Button>
          <Button size="icon" variant="secondary" aria-label="Close">
            <X size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function InputsSection() {
  return (
    <div className="design-section">
      <div className="design-section-header">
        <h2>Inputs & Fields</h2>
        <p>3px radius, 1px hairline border</p>
      </div>

      <div className="component-showcase">
        <h3>Text Input</h3>
        <div className="component-demo component-demo--stacked">
          <Label>
            Title
            <Input placeholder="Enter issue title" style={{ marginTop: "5px" }} />
          </Label>
          <Label>
            With Value
            <Input value="Create local issue workflow" style={{ marginTop: "5px" }} />
          </Label>
          <Label>
            Disabled
            <Input disabled value="Cannot edit this" style={{ marginTop: "5px" }} />
          </Label>
        </div>
      </div>

      <div className="component-showcase">
        <h3>Textarea</h3>
        <div className="component-demo component-demo--stacked">
          <Label>
            Description
            <Textarea
              placeholder="Describe the issue in detail..."
              style={{ marginTop: "5px", minHeight: "100px" }}
            />
          </Label>
        </div>
      </div>
    </div>
  );
}

function BadgesSection() {
  return (
    <div className="design-section">
      <div className="design-section-header">
        <h2>Badges</h2>
        <p>Small status indicators</p>
      </div>

      <div className="component-showcase">
        <h3>Badge Variants</h3>
        <div className="component-demo">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
        </div>
      </div>
    </div>
  );
}

function CardsSection() {
  return (
    <div className="design-section">
      <div className="design-section-header">
        <h2>Cards</h2>
        <p>The Flat Workbench Rule: No card shadows at rest</p>
      </div>

      <div className="component-showcase">
        <h3>Basic Card</h3>
        <div className="component-demo component-demo--stacked">
          <Card style={{ maxWidth: "400px" }}>
            <CardHeader>
              <CardTitle>Card Title</CardTitle>
              <CardDescription>Description here</CardDescription>
            </CardHeader>
            <CardContent>
              <p style={{ fontSize: "13px", lineHeight: "1.45" }}>
                Card content goes here. Keep it compact and focused.
              </p>
            </CardContent>
            <CardFooter>
              <Button variant="secondary">Cancel</Button>
              <Button>Confirm</Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      <div className="component-showcase">
        <h3>Empty State</h3>
        <div className="component-demo component-demo--stacked">
          <Empty
            icon={<Inbox size={40} />}
            title="No issues"
            description="Create an issue to get started"
          >
            <Button>
              <Plus size={16} />
              New Issue
            </Button>
          </Empty>
        </div>
      </div>
    </div>
  );
}

function LayoutsSection() {
  return (
    <div className="design-section">
      <div className="design-section-header">
        <h2>Layouts</h2>
        <p>Template systems for consistent page structure</p>
      </div>

      <div className="component-showcase">
        <h3>Page Layout</h3>
        <div className="component-demo component-demo--stacked">
          <div className="p-4 border border-[var(--color-border)] rounded-[var(--radius-card)]">
            <div className="text-[12px] text-[var(--color-text-muted)] mb-2">
              &lt;PageLayout title="My Page" subtitle="Subtitle here"&gt;
            </div>
            <div className="border border-dashed border-[var(--color-border)] rounded-[var(--radius-card)] p-4">
              <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-[var(--color-border)]">
                <div>
                  <h3 style={{ fontSize: "22px", fontWeight: "650", lineHeight: "1.2", margin: "0" }}>My Page</h3>
                  <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: "1.45", margin: "8px 0 0" }}>Subtitle here</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary">Action</Button>
                  <Button>Primary</Button>
                </div>
              </div>
              <div className="text-[13px] text-[var(--color-text-muted)]">
                Page content goes here
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="component-showcase">
        <h3>Separator</h3>
        <div className="component-demo component-demo--stacked">
          <Card style={{ maxWidth: "400px" }}>
            <CardContent style={{ padding: "14px" }}>
              <p style={{ fontSize: "13px", marginBottom: "12px" }}>
                Above the separator
              </p>
              <Separator />
              <p style={{ fontSize: "13px", marginTop: "12px" }}>
                Below the separator
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
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
    <div className="design-section">
      <div className="design-section-header">
        <h2>Spacing</h2>
        <p>Compact, purposeful spacing system</p>
      </div>

      <div className="spacing-scale">
        {spacing.map((space) => (
          <div key={space.name} className="spacing-item">
            <div className="spacing-label">
              {space.name} ({space.value})
            </div>
            <div
              className="spacing-bar"
              style={{
                width: space.value,
                height: space.value,
                minWidth: "48px",
              }}
            />
          </div>
        ))}
      </div>
    </div>
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
    <div className="design-section">
      <div className="design-section-header">
        <h2>Border Radius</h2>
        <p>Subtle, minimal rounding</p>
      </div>

      <div className="radius-scale">
        {radii.map((radius) => (
          <div key={radius.name} className="radius-item">
            <div
              className="radius-box"
              style={{ borderRadius: radius.value }}
            />
            <div className="radius-info">
              <div className="radius-name">{radius.name}</div>
              <div className="radius-value">{radius.value}</div>
              <div className="radius-usage">{radius.usage}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
