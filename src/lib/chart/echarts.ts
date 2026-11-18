/** ECharts with only the pieces R Board uses, to keep the bundle small. */
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

// The legend component is never drawn (R Board draws its own) but tracks hidden series.
echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

export { echarts };
export type EChartsOption = echarts.EChartsCoreOption;
