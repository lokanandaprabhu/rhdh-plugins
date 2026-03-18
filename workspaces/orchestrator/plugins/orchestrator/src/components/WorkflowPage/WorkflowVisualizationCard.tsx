/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useMemo } from 'react';

import {
  InfoCard,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';

import FitScreenIcon from '@mui/icons-material/FitScreen';
import RefreshIcon from '@mui/icons-material/Refresh';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import {
  ComponentFactory,
  DagreLayout,
  DefaultEdge,
  EdgeModel,
  GRAPH_LAYOUT_END_EVENT,
  GraphComponent,
  GraphElement,
  isNode,
  LabelPosition,
  LayoutFactory,
  Model,
  ModelKind,
  Node,
  NodeModel,
  NodeShape,
  NodeStatus,
  Point,
  TopologyView,
  Visualization,
  VisualizationProvider,
  VisualizationSurface,
  withPanZoom,
} from '@patternfly/react-topology';
import * as yaml from 'js-yaml';

import { useTranslation } from '../../hooks/useTranslation';

import '@patternfly/react-topology/dist/esm/css/topology-components.css';
import '@patternfly/react-topology/dist/esm/css/topology-view.css';

import { observer } from 'mobx-react';
import { makeStyles } from 'tss-react/mui';

type WorkflowStateCondition = {
  transition?: string;
  condition?: string;
};

type WorkflowStateError = {
  transition?: string;
  error?: string;
};

type WorkflowState = {
  name?: string;
  type?: string;
  transition?: string | { nextState?: string };
  end?: boolean | { terminate?: boolean };
  dataConditions?: WorkflowStateCondition[];
  defaultCondition?: WorkflowStateCondition;
  eventConditions?: WorkflowStateCondition[];
  onErrors?: WorkflowStateError[];
};

type WorkflowDefinition = {
  start?: string;
  states?: WorkflowState[];
};

type ParsedWorkflow = {
  definition?: WorkflowDefinition;
  error?: string;
};

const NODE_WIDTH = 240;
const NODE_HEIGHT = 64;

const DAGRE_LAYOUT = 'Dagre';

const layoutFactory: LayoutFactory = (type, graph) => {
  if (type === DAGRE_LAYOUT) {
    return new DagreLayout(graph, {
      ranksep: 5,
      nodesep: 5,
    });
  }
  return undefined;
};

const useStyles = makeStyles()(theme => ({
  topologyRoot: {
    '& .pf-topology-visualization-surface': {
      paddingLeft: '50px',
    },
  },
  controlBar: {
    position: 'absolute',
    bottom: theme.spacing(1),
    left: theme.spacing(1),
    zIndex: 2,
    padding: theme.spacing(0.25),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    borderRadius: theme.shape.borderRadius,
    boxShadow: theme.shadows[1],
  },
  controlButton: {
    padding: theme.spacing(0.5),
  },
}));

const truncateLabel = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
};

const WorkflowNode = observer(
  ({ element }: { element: Node | GraphElement }) => {
    if (!isNode(element)) {
      return null;
    }
    const data =
      (element.getData() as {
        secondaryLabel?: string;
        isPlaceholder?: boolean;
        isStart?: boolean;
      }) ?? {};
    const { width, height } = element.getDimensions();
    const rx = data.isStart ? height / 2 : 8;
    const fill = '#ffffff';
    const stroke = data.isPlaceholder ? '#8a8d90' : '#151515';
    const strokeDasharray = data.isPlaceholder ? '6 4' : undefined;
    const label = truncateLabel(element.getLabel(), 20);
    const secondary = data.secondaryLabel
      ? truncateLabel(data.secondaryLabel, 20)
      : undefined;

    return (
      <g>
        <rect
          width={width}
          height={height}
          rx={rx}
          ry={rx}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray={strokeDasharray}
        />
        <text
          x={width / 2}
          y={height / 2 - (secondary ? 6 : 0)}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#151515"
          fontSize={20}
          fontWeight={700}
        >
          {label}
        </text>
        {secondary && (
          <text
            x={width / 2}
            y={height / 2 + 10}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#6a6e73"
            fontSize={18}
          >
            {secondary}
          </text>
        )}
      </g>
    );
  },
);

const GraphWithPanZoom = withPanZoom()(GraphComponent);

const componentFactory: ComponentFactory = (kind, _type) => {
  switch (kind) {
    case ModelKind.graph:
      return GraphWithPanZoom;
    case ModelKind.node:
      return WorkflowNode;
    case ModelKind.edge:
      return DefaultEdge;
    default:
      return undefined;
  }
};

const parseWorkflowSource = (source: string): ParsedWorkflow => {
  if (!source.trim()) {
    return { error: 'empty' };
  }

  try {
    return { definition: JSON.parse(source) as WorkflowDefinition };
  } catch {
    // fall through to YAML parser
  }

  try {
    const parsed = yaml.load(source);
    if (parsed && typeof parsed === 'object') {
      return { definition: parsed as WorkflowDefinition };
    }
  } catch {
    return { error: 'parse' };
  }

  return { error: 'parse' };
};

const getTransitionTarget = (
  transition: WorkflowState['transition'],
): string | undefined => {
  if (typeof transition === 'string') {
    return transition;
  }
  if (transition && typeof transition === 'object') {
    if (typeof transition.nextState === 'string') {
      return transition.nextState;
    }
  }
  return undefined;
};

const buildModel = (definition: WorkflowDefinition): Model | undefined => {
  const states = definition.states ?? [];
  if (states.length === 0) {
    return undefined;
  }

  const nodes: NodeModel[] = [];
  const edges: EdgeModel[] = [];
  const nodeIds = new Set<string>();

  const ensureNode = (
    id: string,
    label?: string,
    options?: {
      isPlaceholder?: boolean;
      secondaryLabel?: string;
      isStart?: boolean;
    },
  ) => {
    if (nodeIds.has(id)) {
      return;
    }
    nodeIds.add(id);
    const isStart = options?.isStart ?? false;
    nodes.push({
      id,
      type: 'default',
      label: label ?? id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      shape: isStart ? NodeShape.stadium : NodeShape.rect,
      status: isStart ? NodeStatus.info : NodeStatus.default,
      labelPosition: LabelPosition.bottom,
      data: {
        isPlaceholder: options?.isPlaceholder ?? false,
        secondaryLabel: options?.secondaryLabel,
        isStart,
      },
    });
  };

  ensureNode('start', 'Start', { isStart: true, secondaryLabel: 'start' });

  for (const state of states) {
    if (state.name) {
      ensureNode(state.name, state.name, { secondaryLabel: state.type });
    }
  }

  const addEdge = (source: string, target: string, label?: string) => {
    ensureNode(target, target, { isPlaceholder: true });
    edges.push({
      id: `edge-${source}-${target}-${edges.length}`,
      type: 'default',
      source,
      target,
      label,
    });
  };

  if (definition.start) {
    addEdge('start', definition.start, 'start');
  }

  for (const state of states) {
    const stateName = state.name;
    if (!stateName) {
      continue;
    }
    const directTransition = getTransitionTarget(state.transition);
    if (directTransition) {
      addEdge(stateName, directTransition);
    }

    if (Array.isArray(state.dataConditions)) {
      state.dataConditions.forEach((condition, index) => {
        if (condition.transition) {
          addEdge(
            stateName,
            condition.transition,
            condition.condition ?? `condition ${index + 1}`,
          );
        }
      });
    }

    if (state.defaultCondition?.transition) {
      addEdge(stateName, state.defaultCondition.transition, 'default');
    }

    if (Array.isArray(state.eventConditions)) {
      state.eventConditions.forEach((condition, index) => {
        if (condition.transition) {
          addEdge(
            stateName,
            condition.transition,
            condition.condition ?? `event ${index + 1}`,
          );
        }
      });
    }

    if (Array.isArray(state.onErrors)) {
      state.onErrors.forEach((error, index) => {
        if (error.transition) {
          addEdge(
            stateName,
            error.transition,
            error.error ?? `error ${index + 1}`,
          );
        }
      });
    }
  }

  return {
    graph: {
      id: 'workflow-graph',
      type: ModelKind.graph,
      layout: DAGRE_LAYOUT,
    },
    nodes,
    edges,
  };
};

type WorkflowVisualizationCardProps = {
  workflowSource?: string;
  loadingWorkflowSource: boolean;
  errorWorkflowSource?: Error;
};

export const WorkflowVisualizationCard = ({
  workflowSource,
  loadingWorkflowSource,
  errorWorkflowSource,
}: WorkflowVisualizationCardProps) => {
  const { t } = useTranslation();
  const { classes } = useStyles();

  const { model, parseError } = useMemo(() => {
    if (!workflowSource) {
      return { model: undefined, parseError: 'empty' };
    }
    const parsed = parseWorkflowSource(workflowSource);
    if (parsed.error || !parsed.definition) {
      return { model: undefined, parseError: parsed.error ?? 'parse' };
    }
    return { model: buildModel(parsed.definition), parseError: undefined };
  }, [workflowSource]);

  const alignToTopLeft = (graph: ReturnType<Visualization['getGraph']>) => {
    const leftGutter = 56;
    const bounds = graph.getBounds();
    graph.setPosition(
      new Point(
        graph.getPosition().x - bounds.x + leftGutter,
        graph.getPosition().y - bounds.y,
      ),
    );
  };

  const visualization = useMemo(() => {
    if (!model) {
      return undefined;
    }
    const controller = new Visualization();
    controller.registerLayoutFactory(layoutFactory);
    controller.registerComponentFactory(componentFactory);
    controller.addEventListener(GRAPH_LAYOUT_END_EVENT, () => {
      const graph = controller.getGraph();
      alignToTopLeft(graph);
      graph.fit(0);
    });
    controller.fromModel(model);
    return controller;
  }, [model]);

  const controlBar = useMemo(() => {
    if (!visualization) {
      return null;
    }
    return (
      <Paper elevation={2} className={classes.controlBar}>
        <Tooltip title="Zoom in" placement="right">
          <IconButton
            size="small"
            className={classes.controlButton}
            onClick={() => visualization.getGraph().scaleBy(4 / 3)}
          >
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom out" placement="right">
          <IconButton
            size="small"
            className={classes.controlButton}
            onClick={() => visualization.getGraph().scaleBy(0.75)}
          >
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Fit to screen" placement="right">
          <IconButton
            size="small"
            className={classes.controlButton}
            onClick={() => {
              const graph = visualization.getGraph();
              alignToTopLeft(graph);
              graph.fit(0);
            }}
          >
            <FitScreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Reset view" placement="right">
          <IconButton
            size="small"
            className={classes.controlButton}
            onClick={() => {
              visualization.getGraph().reset();
              visualization.getGraph().layout();
            }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Paper>
    );
  }, [classes.controlBar, classes.controlButton, visualization]);

  return (
    <InfoCard title={t('workflow.visualization')}>
      {loadingWorkflowSource && <Progress />}
      {errorWorkflowSource && (
        <ResponseErrorPanel error={errorWorkflowSource} />
      )}
      {!loadingWorkflowSource && !errorWorkflowSource && !workflowSource && (
        <Alert severity="info">{t('workflow.visualizationEmpty')}</Alert>
      )}
      {!loadingWorkflowSource &&
        !errorWorkflowSource &&
        workflowSource &&
        parseError && (
          <Alert severity="warning">{t('workflow.visualizationInvalid')}</Alert>
        )}
      {!loadingWorkflowSource &&
        !errorWorkflowSource &&
        workflowSource &&
        !parseError &&
        !model && (
          <Alert severity="info">{t('workflow.visualizationNoStates')}</Alert>
        )}
      {!loadingWorkflowSource &&
        !errorWorkflowSource &&
        visualization &&
        model && (
          <Box
            sx={{
              height: Math.min(
                900,
                Math.max(320, (model.nodes?.length ?? 0) * 80 + 40),
              ),
              width: '100%',
              marginX: 'auto',
              position: 'relative',
            }}
          >
            {controlBar}
            <TopologyView className={classes.topologyRoot}>
              <VisualizationProvider controller={visualization}>
                <VisualizationSurface />
              </VisualizationProvider>
            </TopologyView>
          </Box>
        )}
    </InfoCard>
  );
};
