import { BrowserRouter, Route, Routes } from "react-router-dom";
import OrderbookWithHtmlElement from "./views/ob-html-elements";
import OrderbookWithHtmlCanvas from "./views/ob-html-canvas";
import MMTOb from "./views/mmt";
import Alert from "./views/alert-ui";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<OrderbookWithHtmlElement />} path="" />
        <Route element={<OrderbookWithHtmlCanvas />} path="/canvas" />
        <Route element={<MMTOb />} path="/mmt" />
        <Route element={<Alert />} path="/alert" />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
