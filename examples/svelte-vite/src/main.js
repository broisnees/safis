import { mount } from "svelte";
import "@safis/core/scoped.css";
import "./app.css";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app") });
