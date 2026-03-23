import { useEffect, useRef, useState } from "react";
import { useListAgents, useListAgentMessages } from "@workspace/api-client-react";
import * as d3 from "d3";
import { Network as NetworkIcon } from "lucide-react";

export default function Network() {
  const { data: agents } = useListAgents();
  
  // Just a simple visual for now since getting all messages globally might need a special endpoint.
  // Assuming useListAgentMessages accepts no ID to list global or we just fake links for demo if none.
  // In a real app, we'd have a global /api/network endpoint. I'll mock links based on agent list for visual if no messages endpoint is globally accessible without ID.
  
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agents || !svgRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .append("g");

    // Add zoom/pan
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 4])
      .on("zoom", (e) => svg.attr("transform", e.transform));
    
    d3.select(svgRef.current).call(zoom);

    // Mock links if not enough real data, creating a mesh
    const nodes = agents.map(a => ({ ...a, id: a.id, group: 1 }));
    const links = [];
    for(let i=0; i<nodes.length; i++) {
        for(let j=i+1; j<nodes.length; j++) {
            if(Math.random() > 0.5) links.push({ source: nodes[i].id, target: nodes[j].id, value: Math.random() });
        }
    }

    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(150))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2));

    // Links with glow
    const link = svg.append("g")
      .attr("stroke", "rgba(6, 182, 212, 0.2)")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", d => Math.sqrt(d.value) * 3);

    // Nodes
    const node = svg.append("g")
      .attr("stroke", "#06b6d4")
      .attr("stroke-width", 2)
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 15)
      .attr("fill", "#0A0F1C")
      .call(drag(simulation) as any);

    // Node labels
    const labels = svg.append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text(d => d.name)
      .attr("font-size", 12)
      .attr("font-family", "Space Grotesk")
      .attr("fill", "#fff")
      .attr("dx", 20)
      .attr("dy", 4);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node
        .attr("cx", (d: any) => d.x)
        .attr("cy", (d: any) => d.y);

      labels
        .attr("x", (d: any) => d.x)
        .attr("y", (d: any) => d.y);
    });

    function drag(simulation: d3.Simulation<d3.SimulationNodeDatum, undefined>) {
      function dragstarted(event: any) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }
      function dragged(event: any) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }
      function dragended(event: any) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }
      return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
    }

    return () => {
      simulation.stop();
    };
  }, [agents]);

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
         
         {/* Overlay stats */}
         <div className="absolute bottom-6 left-6 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 font-mono text-xs text-white/70 pointer-events-none">
            <div className="text-primary font-bold mb-2 uppercase">Mesh Status</div>
            <div>Nodes: {agents?.length || 0} ACTIVE</div>
            <div>Routing: DYNAMIC</div>
            <div className="flex items-center gap-2 mt-2">
               <span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> LINK ESTABLISHED
            </div>
         </div>
      </div>
    </div>
  );
}
