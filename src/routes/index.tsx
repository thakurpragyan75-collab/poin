import { createFileRoute } from "@tanstack/react-router";
import { PoinApp } from "@/components/poin/poin-app";

export const Route = createFileRoute("/")({ component: PoinApp });
