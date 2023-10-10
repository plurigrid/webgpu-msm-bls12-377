import React from "react";
import ReactDOM from "react-dom";
import './main.css';
import { AllBenchmarks } from "./ui/AllBenchmarks";
import { MontProOptimised } from "./ui/MontProOptimised";
import { CUZK } from "./ui/cuZK";

const App = () => (
  <>
    <h1 className="font-bold">Montgomery Multiplication</h1>
    <MontProOptimised /> 

    <h1 className="font-bold">cuZK</h1>
    <CUZK />

    <h1 className="font-bold">MSM Benchmarks {new Date().toLocaleDateString()}</h1>
    <AllBenchmarks />
  </>
);

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById("root")
);
