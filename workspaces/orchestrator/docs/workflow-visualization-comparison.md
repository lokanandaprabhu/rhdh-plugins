## Workflow Visualization: PatternFly Topology vs React Flow

This document summarizes the tradeoffs between the two workflow visualization
cards available in the Orchestrator UI:

- **PatternFly Topology** (`WorkflowVisualizationCard`)
- **React Flow** (`WorkflowVisualizationReactFlowCard`)

Both render the same workflow source, but they differ in layout behavior,
label handling, and extensibility.

### Quick Comparison

| Area         | PatternFly Topology             | React Flow                         |
| ------------ | ------------------------------- | ---------------------------------- |
| Layout       | Dagre layout with PF defaults   | Dagre layout (custom)              |
| Edge labels  | Built-in label placement        | Hidden by default (current config) |
| Custom nodes | SVG-based PF topology nodes     | HTML-based React Flow nodes        |
| Controls     | PF control bar buttons          | Built-in React Flow controls       |
| Styling      | PF theme alignment out-of-box   | Requires custom styling            |
| Complexity   | More built-in topology features | More flexibility, more setup       |
| Dependencies | `@patternfly/react-topology`    | `reactflow`, `@dagrejs/dagre`      |

### PatternFly Topology (PF)

**Advantages**

- Built-in layout and label placement behave well for branching edges.
- Consistent with other PF topology components and styles.
- Works well for SVG-based rendering with fewer custom hooks.
- Less custom logic required to get a usable graph.

**Disadvantages**

- Customizing node content and interactions is more constrained.
- Less flexibility for rich HTML content in nodes.
- PF topology APIs can be heavier for small/simple graphs.

### React Flow

**Advantages**

- Highly flexible node rendering with HTML and React components.
- Easier to extend with custom interactions (hover, tooltips, badges).
- Large ecosystem and community patterns.

**Disadvantages**

- Requires more custom layout tuning (Dagre integration).
- Edge labels can overlap without additional work.
- Styling needs more manual alignment with the PF look-and-feel.

### When to Use Which

- **Prefer PatternFly Topology** when you want a stable, PF-aligned
  visualization with good default layout and label placement.
- **Prefer React Flow** when you want richer node UI, custom interactions,
  or need more control over rendering behavior.

### Notes on Current Configuration

- The React Flow card hides edge labels by default to avoid overlap on
  branching conditions.
- The PF topology card uses the native PF label layout which avoids most
  label collisions.
