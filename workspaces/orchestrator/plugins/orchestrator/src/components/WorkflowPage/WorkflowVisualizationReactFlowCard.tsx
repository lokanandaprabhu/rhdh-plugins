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
import ReactFlow, {
  Background,
  Controls,
  Edge,
  EdgeProps,
  getSmoothStepPath,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
} from 'reactflow';

import {
  InfoCard,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';

import dagre from '@dagrejs/dagre';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import * as yaml from 'js-yaml';

import { useTranslation } from '../../hooks/useTranslation';

import 'reactflow/dist/style.css';

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

type FlowNodeData = {
  label: string;
  secondaryLabel?: string;
  isPlaceholder?: boolean;
  isStart?: boolean;
};

const NODE_GAP_Y = 90;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const VIEWPORT_WIDTH = 920;
const VIEWPORT_HEIGHT = 800;

const WorkflowFlowNode = ({ data }: NodeProps<FlowNodeData>) => {
  const stroke = data.isPlaceholder ? '#8a8d90' : '#151515';
  const strokeStyle = data.isPlaceholder
    ? `1.5px dashed ${stroke}`
    : `1.5px solid ${stroke}`;
  const textColor = data.isPlaceholder ? '#6a6e73' : '#151515';
  const radius = data.isStart ? 20 : 6;

  return (
    <div
      style={{
        background: '#ffffff',
        border: strokeStyle,
        borderRadius: radius,
        padding: '8px 12px',
        minWidth: 160,
        textAlign: 'center',
        fontWeight: 600,
        fontSize: 14,
        color: textColor,
        boxShadow: '0 1px 2px rgba(3,3,3,0.1)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div>{data.label}</div>
      {data.secondaryLabel && (
        <div style={{ fontSize: 11, fontWeight: 500, color: '#6a6e73' }}>
          {data.secondaryLabel}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
};

const nodeTypes = { workflowNode: WorkflowFlowNode };
const edgeTypes = {
  labeled: ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
  }: EdgeProps) => {
    const [edgePath] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });

    return (
      <>
        <path
          id={id}
          className="react-flow__edge-path"
          d={edgePath}
          markerEnd={markerEnd}
        />
      </>
    );
  },
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

const buildFlow = (
  definition: WorkflowDefinition,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } | undefined => {
  const states = definition.states ?? [];
  if (states.length === 0) {
    return undefined;
  }

  const nodeIds = new Set<string>();
  const nodeOrder: string[] = [];
  const nodeMap = new Map<string, Node<FlowNodeData>>();
  const edges: Edge[] = [];

  const ensureNode = (
    id: string,
    label: string,
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
    nodeOrder.push(id);
    nodeMap.set(id, {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label,
        secondaryLabel: options?.secondaryLabel,
        isPlaceholder: options?.isPlaceholder,
        isStart: options?.isStart,
      },
    });
  };

  ensureNode('start', 'Start', { isStart: true, secondaryLabel: 'start' });

  for (const state of states) {
    if (state.name) {
      ensureNode(state.name, state.name, { secondaryLabel: state.type });
    }
  }

  const addEdge = (source: string, target: string) => {
    ensureNode(target, target, { isPlaceholder: true });
    edges.push({
      id: `edge-${source}-${target}-${edges.length}`,
      source,
      target,
      type: 'labeled',
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  };

  if (definition.start) {
    addEdge('start', definition.start);
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
      state.dataConditions.forEach(condition => {
        if (condition.transition) {
          addEdge(stateName, condition.transition);
        }
      });
    }

    if (state.defaultCondition?.transition) {
      addEdge(stateName, state.defaultCondition.transition);
    }

    if (Array.isArray(state.eventConditions)) {
      state.eventConditions.forEach(condition => {
        if (condition.transition) {
          addEdge(stateName, condition.transition);
        }
      });
    }

    if (Array.isArray(state.onErrors)) {
      state.onErrors.forEach(error => {
        if (error.transition) {
          addEdge(stateName, error.transition);
        }
      });
    }
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    ranksep: NODE_GAP_Y,
    nodesep: 40,
  });

  nodeOrder.forEach(id => {
    g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach(edge => {
    g.setEdge(edge.source, edge.target);
  });
  dagre.layout(g);

  let nodes: Node<FlowNodeData>[] = [];
  nodeOrder.forEach(id => {
    const node = nodeMap.get(id);
    const layout = g.node(id);
    if (!node || !layout) {
      return;
    }
    nodes.push({
      ...node,
      position: {
        x: layout.x - NODE_WIDTH / 2,
        y: layout.y - NODE_HEIGHT / 2,
      },
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
    });
  });

  const minX = Math.min(...nodes.map(node => node.position.x));
  const minY = Math.min(...nodes.map(node => node.position.y));
  const maxX = Math.max(...nodes.map(node => node.position.x + NODE_WIDTH));
  const maxY = Math.max(...nodes.map(node => node.position.y + NODE_HEIGHT));
  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const offsetX = Math.max(20, (VIEWPORT_WIDTH - contentWidth) / 2 - minX);
  const offsetY = Math.max(20, (VIEWPORT_HEIGHT - contentHeight) / 2 - minY);
  nodes = nodes.map(node => ({
    ...node,
    position: {
      x: node.position.x + offsetX,
      y: node.position.y + offsetY,
    },
  }));

  return { nodes, edges };
};

type WorkflowVisualizationReactFlowCardProps = {
  workflowSource?: string;
  loadingWorkflowSource: boolean;
  errorWorkflowSource?: Error;
};

export const WorkflowVisualizationReactFlowCard = ({
  workflowSource,
  loadingWorkflowSource,
  errorWorkflowSource,
}: WorkflowVisualizationReactFlowCardProps) => {
  const { t } = useTranslation();

  const { flow, parseError } = useMemo(() => {
    if (!workflowSource) {
      return { flow: undefined, parseError: 'empty' };
    }
    const parsed = parseWorkflowSource(workflowSource);
    if (parsed.error || !parsed.definition) {
      return { flow: undefined, parseError: parsed.error ?? 'parse' };
    }
    return {
      flow: buildFlow(parsed.definition),
      parseError: undefined,
    };
  }, [workflowSource]);

  return (
    <InfoCard title={t('workflow.visualizationReactFlow')}>
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
        !flow && (
          <Alert severity="info">{t('workflow.visualizationNoStates')}</Alert>
        )}
      {!loadingWorkflowSource && !errorWorkflowSource && flow && (
        <Box
          sx={{
            height: 800,
            width: '100%',
            maxWidth: 920,
            marginX: 'auto',
          }}
        >
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
          >
            <Background gap={16} />
            <Controls />
          </ReactFlow>
        </Box>
      )}
    </InfoCard>
  );
};
