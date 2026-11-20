using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MiniCpuGui
{
    public partial class Form1 : Form
    {
        // ==========================================================
        // BRIDGE TO x86 ASSEMBLY DLL (MiniCPU.dll)
        // ==========================================================
        [DllImport("MiniCPU.dll", CallingConvention = CallingConvention.StdCall)]
        public static extern void ResetCPU();

        [DllImport("MiniCPU.dll", CallingConvention = CallingConvention.StdCall)]
        public static extern void LoadProgram(int progId);

        [DllImport("MiniCPU.dll", CallingConvention = CallingConvention.StdCall)]
        public static extern int StepCPU();

        [DllImport("MiniCPU.dll", CallingConvention = CallingConvention.StdCall)]
        public static extern int GetReg(int regIndex);

        [DllImport("MiniCPU.dll", CallingConvention = CallingConvention.StdCall)]
        public static extern int GetPC();

        [DllImport("MiniCPU.dll", CallingConvention = CallingConvention.StdCall)]
        public static extern int GetZF();

        [DllImport("MiniCPU.dll", CallingConvention = CallingConvention.StdCall)]
        public static extern int IsProgramLoaded();

        // UI Controls
        private Label lblAX, lblBX, lblCX, lblDX, lblPC, lblZF, lblStatus;
        private ListBox lstInstructions;
        private int currentProgramId = 0;

        private readonly string[] prog1Lines = {
            "[0] MOV AX, 10",
            "[1] MOV BX, 5",
            "[2] ADD AX, BX",
            "[3] SUB AX, 2",
            "[4] HLT"
        };

        private readonly string[] prog2Lines = {
            "[0] MOV AX, 10",
            "[1] MOV BX, 10",
            "[2] CMP AX, BX",
            "[3] JZ  5",
            "[4] MOV CX, 99  (Skipped)",
            "[5] MOV DX, 42",
            "[6] HLT"
        };

        public Form1()
        {
            BuildDashboardUI();
            ResetCPU();
            RefreshUI();
        }

        private void BuildDashboardUI()
        {
            this.Text = "Mini CPU Simulator - x86 MASM Engine (All 7 Options)";
            this.Size = new Size(680, 480);
            this.BackColor = Color.FromArgb(28, 28, 34);
            this.ForeColor = Color.White;
            this.Font = new Font("Consolas", 10.5F, FontStyle.Bold);

            // LEFT PANEL: 7 Menu Option Buttons
            Label lblMenuTitle = new Label()
            {
                Text = "CPU CONTROL MENU",
                Location = new Point(20, 15),
                AutoSize = true,
                ForeColor = Color.Cyan
            };
            this.Controls.Add(lblMenuTitle);

            CreateMenuButton("[1] Load Sample Program 1", 20, 45, Color.FromArgb(45, 95, 155), (s, e) =>
            {
                LoadProgram(1);
                currentProgramId = 1;
                lstInstructions.Items.Clear();
                lstInstructions.Items.AddRange(prog1Lines);
                lblStatus.Text = "Status: Sample Program 1 loaded (Arithmetic).";
                RefreshUI();
            });

            CreateMenuButton("[2] Load Sample Program 2", 20, 95, Color.FromArgb(45, 95, 155), (s, e) =>
            {
                LoadProgram(2);
                currentProgramId = 2;
                lstInstructions.Items.Clear();
                lstInstructions.Items.AddRange(prog2Lines);
                lblStatus.Text = "Status: Sample Program 2 loaded (CMP & JZ Branch).";
                RefreshUI();
            });

            CreateMenuButton("[3] View Loaded Instructions", 20, 145, Color.FromArgb(65, 65, 80), (s, e) =>
            {
                if (IsProgramLoaded() == 0)
                {
                    MessageBox.Show("No program loaded! Select Option [1] or [2] first.", "Error");
                    return;
                }
                string list = string.Join("\n", currentProgramId == 1 ? prog1Lines : prog2Lines);
                MessageBox.Show(list, $"Stored Instructions (Program {currentProgramId})");
            });

            CreateMenuButton("[4] View Registers & Flags", 20, 195, Color.FromArgb(65, 65, 80), (s, e) =>
            {
                string state = $"AX = {GetReg(0)}\nBX = {GetReg(1)}\nCX = {GetReg(2)}\nDX = {GetReg(3)}\n\nPC = {GetPC()}\nZF = {GetZF()}";
                MessageBox.Show(state, "Current Virtual CPU State");
            });

            CreateMenuButton("[5] Step Instruction (Execute)", 20, 245, Color.FromArgb(0, 135, 90), (s, e) =>
            {
                int res = StepCPU();
                if (res == -1)
                {
                    MessageBox.Show("No program loaded! Load Program 1 or 2 first.", "Error");
                    return;
                }
                RefreshUI();
                if (res == 0)
                {
                    lblStatus.Text = "Status: [HLT] Execution finished.";
                    MessageBox.Show("HLT reached! Execution complete.", "CPU Halted");
                }
                else
                {
                    lblStatus.Text = $"Status: Executed step. Next PC = {GetPC()}";
                }
            });

            CreateMenuButton("[6] Reset Virtual CPU", 20, 295, Color.FromArgb(170, 95, 30), (s, e) =>
            {
                ResetCPU();
                lblStatus.Text = "Status: Virtual CPU registers, PC, and ZF reset to 0.";
                RefreshUI();
            });

            CreateMenuButton("[7] Exit Simulator", 20, 345, Color.FromArgb(165, 45, 45), (s, e) =>
            {
                Application.Exit();
            });

            // CENTER PANEL: Instruction Memory ListBox
            Label lblMemTitle = new Label()
            {
                Text = "INSTRUCTION MEMORY",
                Location = new Point(300, 15),
                AutoSize = true,
                ForeColor = Color.LightGreen
            };
            this.Controls.Add(lblMemTitle);

            lstInstructions = new ListBox()
            {
                Location = new Point(300, 45),
                Size = new Size(210, 340),
                BackColor = Color.FromArgb(40, 40, 48),
                ForeColor = Color.LightGreen,
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(lstInstructions);

            // RIGHT PANEL: Virtual Registers & Flags
            Label lblRegTitle = new Label()
            {
                Text = "REGISTERS",
                Location = new Point(530, 15),
                AutoSize = true,
                ForeColor = Color.Orange
            };
            this.Controls.Add(lblRegTitle);

            lblAX = CreateRegLabel("AX: 0", 530, 50);
            lblBX = CreateRegLabel("BX: 0", 530, 95);
            lblCX = CreateRegLabel("CX: 0", 530, 140);
            lblDX = CreateRegLabel("DX: 0", 530, 185);
            lblPC = CreateRegLabel("PC: 0", 530, 250, Color.Cyan);
            lblZF = CreateRegLabel("ZF: 0", 530, 295, Color.Orange);

            // BOTTOM STATUS BAR
            lblStatus = new Label()
            {
                Text = "Status: Ready. Select Option [1] or [2] to load a program.",
                Location = new Point(20, 405),
                AutoSize = true,
                ForeColor = Color.LightGray
            };
            this.Controls.Add(lblStatus);
        }

        private void CreateMenuButton(string text, int x, int y, Color bg, EventHandler onClick)
        {
            Button btn = new Button()
            {
                Text = text,
                Location = new Point(x, y),
                Size = new Size(255, 40),
                BackColor = bg,
                ForeColor = Color.White,
                TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(8, 0, 0, 0),
                FlatStyle = FlatStyle.Flat
            };
            btn.Click += onClick;
            this.Controls.Add(btn);
        }

        private Label CreateRegLabel(string text, int x, int y, Color? color = null)
        {
            Label lbl = new Label()
            {
                Text = text,
                Location = new Point(x, y),
                AutoSize = true,
                Font = new Font("Consolas", 13F, FontStyle.Bold),
                ForeColor = color ?? Color.White
            };
            this.Controls.Add(lbl);
            return lbl;
        }

        private void RefreshUI()
        {
            lblAX.Text = $"AX: {GetReg(0)}";
            lblBX.Text = $"BX: {GetReg(1)}";
            lblCX.Text = $"CX: {GetReg(2)}";
            lblDX.Text = $"DX: {GetReg(3)}";

            int pc = GetPC();
            lblPC.Text = $"PC: {pc}";
            lblZF.Text = $"ZF: {GetZF()}";

            if (lstInstructions.Items.Count > 0 && pc < lstInstructions.Items.Count)
                lstInstructions.SelectedIndex = pc;
        }
    }
}