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
  Point,
  TopologyView,
  Visualization,
  VisualizationProvider,
  VisualizationSurface,
  withPanZoom,
} from '@patternfly/react-topology';
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';

import { useTranslation } from '../../hooks/useTranslation';

import '@patternfly/react-topology/dist/esm/css/topology-components.css';
import '@patternfly/react-topology/dist/esm/css/topology-view.css';

import { observer } from 'mobx-react';
import { makeStyles } from 'tss-react/mui';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 48;
const DAGRE_LAYOUT = 'Dagre';
const MAX_DEPTH = 3;

const layoutFactory: LayoutFactory = (type, graph) => {
  if (type === DAGRE_LAYOUT) {
    return new DagreLayout(graph, {
      ranksep: 80,
      nodesep: 50,
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

const SchemaNode = observer(({ element }: { element: Node | GraphElement }) => {
  if (!isNode(element)) {
    return null;
  }
  const data =
    (element.getData() as {
      secondaryLabel?: string;
      isRoot?: boolean;
    }) ?? {};
  const { width, height } = element.getDimensions();
  const rx = data.isRoot ? height / 2 : 8;
  const fill = '#ffffff';
  const stroke = '#151515';
  const label = element.getLabel();
  const secondary = data.secondaryLabel;

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
      />
      <text
        x={width / 2}
        y={height / 2 - (secondary ? 6 : 0)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#151515"
        fontSize={12}
        fontWeight={600}
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
          fontSize={10}
        >
          {secondary}
        </text>
      )}
    </g>
  );
});

const GraphWithPanZoom = withPanZoom()(GraphComponent);

const componentFactory: ComponentFactory = (kind, _type) => {
  switch (kind) {
    case ModelKind.graph:
      return GraphWithPanZoom;
    case ModelKind.node:
      return SchemaNode;
    case ModelKind.edge:
      return DefaultEdge;
    default:
      return undefined;
  }
};

const getSchemaType = (
  schema: JSONSchema7Definition | JSONSchema7Definition[],
): string | undefined => {
  if (Array.isArray(schema)) {
    const types = schema
      .map(entry => getSchemaType(entry))
      .filter((value): value is string => !!value);
    return types.length > 0 ? types.join(' | ') : 'tuple';
  }
  if (schema === true || schema === false) {
    return undefined;
  }
  const type = schema.type;
  if (Array.isArray(type)) {
    return type.join(' | ');
  }
  return type;
};

const isObjectSchema = (schema: JSONSchema7Definition): schema is JSONSchema7 =>
  typeof schema === 'object' && schema !== null;

const buildModelFromSchema = (schema: JSONSchema7): Model | undefined => {
  if (!schema || (!schema.properties && !schema.items)) {
    return undefined;
  }

  const nodes: NodeModel[] = [];
  const edges: EdgeModel[] = [];
  const nodeIds = new Set<string>();

  const ensureNode = (
    id: string,
    label: string,
    secondaryLabel?: string,
    isRoot = false,
  ) => {
    if (nodeIds.has(id)) {
      return;
    }
    nodeIds.add(id);
    nodes.push({
      id,
      type: 'default',
      label,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      shape: isRoot ? NodeShape.stadium : NodeShape.rect,
      labelPosition: LabelPosition.bottom,
      data: {
        secondaryLabel,
        isRoot,
      },
    });
  };

  const addEdge = (source: string, target: string) => {
    edges.push({
      id: `edge-${source}-${target}-${edges.length}`,
      type: 'default',
      source,
      target,
    });
  };

  const rootId = 'schema-root';
  ensureNode(rootId, 'Input Schema', getSchemaType(schema), true);

  const walk = (current: JSONSchema7, parentId: string, depth: number) => {
    if (depth >= MAX_DEPTH) {
      return;
    }
    if (current.properties) {
      Object.entries(current.properties).forEach(([key, value]) => {
        if (!isObjectSchema(value)) {
          return;
        }
        const nodeId = `${parentId}.${key}`;
        ensureNode(nodeId, key, getSchemaType(value));
        addEdge(parentId, nodeId);
        walk(value, nodeId, depth + 1);
      });
    }

    if (current.items) {
      const nodeId = `${parentId}.[items]`;
      if (Array.isArray(current.items)) {
        ensureNode(nodeId, 'items', 'tuple');
        addEdge(parentId, nodeId);
        current.items.forEach((entry, index) => {
          if (!isObjectSchema(entry)) {
            return;
          }
          const itemNodeId = `${nodeId}.${index}`;
          ensureNode(itemNodeId, `item ${index + 1}`, getSchemaType(entry));
          addEdge(nodeId, itemNodeId);
          walk(entry, itemNodeId, depth + 1);
        });
      } else if (isObjectSchema(current.items)) {
        ensureNode(nodeId, 'items', getSchemaType(current.items));
        addEdge(parentId, nodeId);
        walk(current.items, nodeId, depth + 1);
      }
    }
  };

  walk(schema, rootId, 0);

  return {
    graph: {
      id: 'schema-graph',
      type: ModelKind.graph,
      layout: DAGRE_LAYOUT,
    },
    nodes,
    edges,
  };
};

type InputSchemaVisualizationCardProps = {
  inputSchema?: JSONSchema7;
  loadingInputSchema: boolean;
  errorInputSchema?: Error;
};

export const InputSchemaVisualizationCard = ({
  inputSchema,
  loadingInputSchema,
  errorInputSchema,
}: InputSchemaVisualizationCardProps) => {
  const { t } = useTranslation();
  const { classes } = useStyles();

  const model = useMemo(() => {
    if (!inputSchema) {
      return undefined;
    }
    return buildModelFromSchema(inputSchema);
  }, [inputSchema]);

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
    <InfoCard title={t('workflow.inputSchemaVisualization')}>
      {loadingInputSchema && <Progress />}
      {errorInputSchema && <ResponseErrorPanel error={errorInputSchema} />}
      {!loadingInputSchema && !errorInputSchema && !inputSchema && (
        <Alert severity="info">
          {t('workflow.inputSchemaVisualizationEmpty')}
        </Alert>
      )}
      {!loadingInputSchema && !errorInputSchema && inputSchema && !model && (
        <Alert severity="info">
          {t('workflow.inputSchemaVisualizationNoFields')}
        </Alert>
      )}
      {!loadingInputSchema && !errorInputSchema && visualization && model && (
        <Box
          sx={{
            height: 520,
            width: '100%',
            maxWidth: 820,
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
