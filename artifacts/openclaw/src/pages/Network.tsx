import { useEffect, useRef } from "react";
import { useListAgents } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import * as d3 from "d3";
import { Network as NetworkIcon } from "lucide-react";

interface NetworkEdge {
  source: number;
  target: number;
  count: number;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: number;
  name: string;
  status: string;
  group: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  value: number;
}

function useNetworkEdges() {
  return useQuery<NetworkEdge[]>({
    queryKey: ["/api/network/edges"],
    queryFn: async () => {
      const res = await fetch("/api/network/edges");
      if (!res.ok) throw new Error("Failed to fetch edges");
      return res.json() as Promise<NetworkEdge[]>;
    },
    refetchInterval: 10000,
  });
}

export default function Network() {
  const { data: agents } = useListAgents();
  const { data: edges } = useNetworkEdges();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agents || !svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 4])
      .on("zoom", (e) => svg.attr("transform", e.transform));

    d3.select(svgRef.current).call(zoom);

    const nodes: SimNode[] = agents.map(a => ({
      id: a.id,
      name: a.name,
      status: a.status ?? "idle",
      group: 1,
    }));

    const nodeIdSet = new Set(nodes.map(n => n.id));
    const realEdges = (edges ?? []).filter(
      e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
    );

    const links: SimLink[] = realEdges.map(e => ({
      source: e.source,
      target: e.target,
      value: e.count,
    }));

    const simulation = d3.forceSimulation<SimNode>(nodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2));

    const link = svg.append("g")
      .attr("stroke", "rgba(6, 182, 212, 0.3)")
      .attr("stroke-opacity", 0.8)
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke-width", d => Math.max(1, Math.sqrt(d.value) * 2));

    const node = svg.append("g")
      .attr("stroke", "#06b6d4")
      .attr("stroke-width", 2)
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 18)
      .attr("fill", "#0A0F1C")
      .call(drag(simulation));

    const pulseRing = svg.append("g")
      .selectAll<SVGCircleElement, SimNode>("circle.pulse")
      .data(nodes)
      .join("circle")
      .attr("class", "pulse")
      .attr("r", 18)
      .attr("fill", "none")
      .attr("stroke", "#06b6d4")
      .attr("stroke-width", 1)
      .attr("opacity", 0.4);

    const labels = svg.append("g")
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes)
      .join("text")
      .text(d => d.name)
      .attr("font-size", 12)
      .attr("font-family", "Space Grotesk, sans-serif")
      .attr("fill", "#fff")
      .attr("dx", 24)
      .attr("dy", 4)
      .attr("pointer-events", "none");

    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as SimNode).x ?? 0)
        .attr("y1", d => (d.source as SimNode).y ?? 0)
        .attr("x2", d => (d.target as SimNode).x ?? 0)
        .attr("y2", d => (d.target as SimNode).y ?? 0);

      node
        .attr("cx", d => d.x ?? 0)
        .attr("cy", d => d.y ?? 0);

      pulseRing
        .attr("cx", d => d.x ?? 0)
        .attr("cy", d => d.y ?? 0);

      labels
        .attr("x", d => d.x ?? 0)
        .attr("y", d => d.y ?? 0);
    });

    function drag(sim: d3.Simulation<SimNode, SimLink>) {
      return d3.drag<SVGCircleElement, SimNode>()
        .on("start", (event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>) => {
          if (!event.active) sim.alphaTarget(0.3).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
        })
        .on("drag", (event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>) => {
          event.subject.fx = event.x;
          event.subject.fy = event.y;
        })
        .on("end", (event: d3.D3DragEvent<SVGCircleElement, SimNode, SimNode>) => {
          if (!event.active) sim.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
        });
    }

    return () => { simulation.stop(); };
  }, [agents, edges]);

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
      <header className="mb-6 shrink-0 z-10 pointer-events-none relative">
        <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
          <NetworkIcon className="w-8 h-8 text-primary" />
          Neural Mesh
        </h1>
        <p className="text-muted-foreground mt-2 text-sm font-mono">LIVE TOPOLOGY & DELEGATION TRACKING</p>
      </header>

      <div className="flex-1 glass-panel rounded-2xl relative overflow-hidden" ref={containerRef}>
        <svg ref={svgRef} className="absolute inset-0 w-full h-full cursor-move" />

        <div className="absolute bottom-6 left-6 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 font-mono text-xs text-white/70 pointer-events-none">
          <div className="text-primary font-bold mb-2 uppercase">Mesh Status</div>
          <div>Nodes: {agents?.length ?? 0} ACTIVE</div>
          <div>Edges: {edges?.length ?? 0} LINKS</div>
          <div>Routing: DYNAMIC</div>
          <div className="flex items-center gap-2 mt-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> LINK ESTABLISHED
          </div>
        </div>
      </div>
    </div>
  );
}
